# Map matching

Turning a raw GPS track into "which street, when".

```ts
import { matchTrack, attributeFrames } from "@/lib/matching";

const match = matchTrack(track, { frames });
const bySeq = attributeFrames(match, frames);
```

Import from `@/lib/matching`, never from an implementation file. `types.ts` is
the contract and is authoritative; `index.ts` picks the active implementation.

`matchTrack` is server-side by default (it lazily reads `data/segments.geojson`).
Pass `opts.segments` to use it anywhere, and in tests.

## What is here

| File | Role |
|---|---|
| `types.ts` | The frozen contract. Types only, safe to import anywhere. |
| `hmm.ts` | **The active matcher.** Newson-Krumm HMM. |
| `graph.ts` | The segment graph the HMM's transition model walks. |
| `baseline.ts` | The naive matcher. NOT dead code — see below. |

`baseline.ts` stays on purpose. `scripts/test-matching-hmm.mjs` asserts that on a
pair of parallel streets the HMM holds the right one **and that the baseline
flips off it**. Without that second assertion the first proves nothing: a
matcher that always returned the nearest street would pass it. If you delete the
baseline, that test stops testing anything.

## The model

Newson & Krumm 2009, *Hidden Markov Map Matching Through Noise and Sparseness*.

- **States** — one candidate per nearby segment: the point on that segment
  closest to the fix.
- **Emission** — Gaussian on the perpendicular distance from fix to segment.
- **Transition** — exponential on `|great-circle distance − on-network distance|`.

The transition term is the whole point. Hopping to a parallel street 15 m away
means walking to the corner and back, so the on-network distance is ~200 m while
the fixes moved ~15 m. That mismatch is what makes the flip cost more than it is
worth, and it is exactly what the baseline cannot see.

Transitions are **adjacency-restricted**, not Dijkstra-routed: a pair is
reachable only if both candidates are on the same segment or on segments sharing
a node. At 1 Hz on foot a fix moves ~1.4 m, so consecutive fixes are never more
than one junction apart and a shortest-path search per candidate pair would buy
nothing for a large constant factor. If this is ever fed vehicle traces at 1 fix
per 30 s, that assumption breaks and the transition model needs real routing.

### Honesty over coverage

The matcher never throws and never bridges what it cannot vouch for. Three
things cut the track into sub-trajectories, each reported as an `unmatchedSpan`:

- a fix with no candidate inside the gate (off-network),
- a column where every transition is impossible (a teleport),
- a hole longer than `maxGapSeconds`.

Claiming coverage we do not have is the one failure mode that matters here: a
segment reported as filmed is a segment nobody will film again.

## Parameters

Everything below is an option with this default. The first three are the frozen
contract's (`types.ts`); the rest are additive (`HmmOptions`).

| Option | Default | Why |
|---|---|---|
| `gateMeters` | 30 | Consumer GPS error in a low-rise grid. >2.5σ, so emission is already negligible at the gate. |
| `minRunFixes` | 2 | A one-fix run on a street is flicker, not a pass. |
| `junctionRadiusM` | 20 | A frame this close to a node reads the junction, not the block face. |
| `sigmaZMeters` | 10 | Emission σ. Newson-Krumm fit ~4.07 m to vehicle GPS; phone-in-hand walking is noisier. |
| `betaMeters` | 2.0 | Transition scale. Straight from the paper; tolerant of a few metres of route/line mismatch, punishing beyond that. |
| `maxCandidates` | 5 | Past ~5 the extra states are all worse than the gate. |
| `maxAccuracyMeters` | 25 | A fix the phone itself distrusts is noise, not evidence. |
| `minStepMeters` | 2 | Below this the fix adds nothing (standing still). The track's **last** fix is always kept regardless: it bounds the track in time. |
| `maxGapSeconds` | 30 | Longer than this we cannot say where they went. Cut, do not bridge. |
| `minTraversalMeters` | 10 | Shorter than this is a noise artifact, not a pass. |
| `minTraversalFrames` | 3 | Only when `frames` are supplied. A pass nobody filmed is not evidence of coverage. |
| `headingWeight` | 0.5 | A tiebreak between near-equal candidates, never a filter. Always ≤ 0. |
| `reversalMeters` | 25 | Below this a "turnaround" is along-track noise. See tuning notes. |

## Tuning notes

**σ_z and β interact.** σ_z says how far off-street a fix may plausibly be; β
says how much route/line mismatch to tolerate. Raising σ_z alone makes the
matcher credulous about parallel streets; lowering β alone makes it rigid at
junctions, where a fix on the corner is genuinely near-equidistant from both
arms. Change one, re-run `scripts/test-matching-hmm.mjs`, and watch case 2.

**`reversalMeters` must clear the along-track noise, not the map error.** A
fix's `location` is the foot of a perpendicular from a noisy point, so it jitters
with the same σ_z as the perpendicular error — on a dead-straight walk the
series routinely swings 15-20 m peak-to-trough while going nowhere but forward.
Detection therefore runs on a smoothed series, and the threshold sits well above
that noise and well below a real turnaround (which retraces a whole block).

**Do not measure travel by summing per-fix movement.** It integrates the noise:
a real 120 m walk measured 664 m that way. A pass is measured entry-to-exit.
This is also why `minTraversalMeters` works at all — with summed lengths, every
one-fix flicker looked long enough to report.

**Length means two different things at two different stages, and swapping them
loses whole streets.** Deciding whether a *run* is real asks how much of the
street it covered, so it uses the run's **extent** (`max − min` of location).
Measuring a *pass* asks how far the walk got, so it uses **entry-to-exit
displacement**. Using displacement for the run test silently deleted
out-and-back walks: a walk up a street and back ends where it started, so its
displacement is ~0, the run failed the 10 m floor, and a street that was walked
twice reported no coverage at all.

**`metadata.bbox` in `data/segments.geojson` is a footgun.** It is in Overpass's
lat-first order (`[minLat, minLng, maxLat, maxLng]`), which is NOT the GeoJSON
convention. Reading it would silently transpose every gate check into the ocean.
Bboxes are always computed from geometry.

**The graph joins on exact coordinate strings.** `segments.geojson` and
`routing-network.geojson` are both 6-decimal rounded and byte-identical at
shared vertices, so segments that meet share a coordinate exactly. A
tolerance-based join would be slower and would fuse distinct corners of a tight
junction. If a future dataset breaks that guarantee, `nodeKey` in `graph.ts` is
the single place to change.

## Testing

```
node scripts/test-matching-hmm.mjs       # the HMM, on real network geometry
node scripts/test-matching-baseline.mjs  # the contract, via the baseline
```

Fixtures are real segment ids from `data/segments.geojson`, picked by measuring
the network. Noise is a seeded PRNG: the matcher is deterministic and so are its
tests.
