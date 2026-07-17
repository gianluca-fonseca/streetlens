# u26 — HMM map matching: validated plan

Seed validated against the worktree. Architecture accepted as sealed. Two
deviations and one gap are logged below with reasons.

## Fixtures — picked by inspection of the REAL data/segments.geojson

Selection was done by measuring the network (535 LineStrings), not by guessing.
Tests inject the full real 535-segment network as `opts.segments` and synthesize
tracks along known geometry, so a fixture is an id plus an expected result.

| Test | Fixture | Evidence |
|---|---|---|
| 1 straight | `esc-sa-0170` "Calle Avellana" | 233 m, sinuosity 1.000, no non-adjacent segment within 45 m of its middle 80% |
| 2 parallel | A=`esc-sa-0451` "Calle Antigua" (162 m) vs B=`esc-sa-0196` "Calle Monte Abajo" (296 m) | non-adjacent, 120 m contiguous overlap at 12.4–17.8 m separation |
| 3 L-junction | `esc-sa-0090` + `esc-sa-0291` at node `-84.14219,9.916591` | shared endpoint, turn angle 96° |
| 4 dropout | `esc-sa-0170`, 60 s hole | — |
| 5 off-network | `[-84.1324, 9.9040]` | nearest segment 191 m |
| 6 attribution | along test 3 | — |

### Gap vs the seed (logged)
The seed asked for "two parallel streets ~15–25 m apart". **No pair in this
network is flat-parallel in that band along a whole street**: a densified scan
(5 m steps, 12–30 m band, non-adjacent) returned zero pairs covering ≥80% of any
segment ≥100 m. Real block faces converge at their ends. The honest equivalent
is the longest *contiguous overlap*: `esc-sa-0451` ‖ `esc-sa-0196` holds
12.4–17.8 m over 120 m, which is TIGHTER than the seed's band and therefore a
strictly harder flip-flop test. The walk is confined to that overlap.

## Deviations from the seed (with reason)
1. **Candidate gate = `opts.gateMeters ?? 30`, not a fixed 35 m.** `types.ts` is
   FROZEN and documents "Default 30 m" for `gateMeters`; a 35 m candidate radius
   would silently contradict the frozen contract and the option would stop
   meaning what it says. 30 m > 2.5 sigma, so the emission term is already
   negligible at the gate.
2. **The `< 3 attributed frames` traversal filter applies only when frames are
   supplied.** Applying it unconditionally would drop every traversal on a
   frameless match (`frames` is optional in the contract, and test 1 matches
   without frames), i.e. it would return zero traversals for a perfect walk.

## Implementation order (atomic commits)
1. `lib/matching/graph.ts` — segment graph: exact-string coord keys, node map,
   adjacency, rbush bbox index (bboxes computed from geometry; `metadata.bbox`
   is lat-first Overpass order and is NEVER read).
2. `lib/matching/hmm.ts` — preprocess (accuracy > 25 m drop, < 2 m dedupe),
   candidates (gate + `nearestPointOnLine` → dist/location, cap 5), emission
   (Gaussian, sigma_z 10 m), transition (adjacency-restricted, beta 2.0),
   Viterbi + backtrace, sub-trajectory split on an all-(-Inf) column,
   attribution by distance-along-route, junction buffers, traversal filter.
3. `lib/matching/index.ts` — swap the active matcher to `./hmm`.
4. `scripts/test-matching-hmm.mjs` — the 6 tests + the baseline-flips regression.
5. `lib/matching/README.md` — parameters and tuning notes.

`baseline.ts` STAYS: test 2 asserts the naive baseline DOES flip, which is the
regression guard proving the HMM earns its keep.

## Gates
`npx tsc --noEmit`, `npm run lint`, `npm run build`, `node scripts/test-matching-hmm.mjs`,
plus `node scripts/test-matching-baseline.mjs` (unchanged contract must stay green).
Evidence → `.planning/evidence/u26/`.
