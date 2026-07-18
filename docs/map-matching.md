# Map matching: which street was this frame on?

Every scored frame has to be pinned to one exact street segment. That is the
whole job of the map matcher. This page explains the problem, the model that
solves it, and why it holds where a simpler approach breaks. For the code-level
reference inside the funnel, see
[cv-funnel.md](cv-funnel.md#map-matching); the matcher itself lives in
`lib/matching/`.

## The problem

A phone in your hand does not know exactly where it is. Its GPS wanders 5 to 15
meters, and city streets sit close together. So the obvious approach, snap each
frame to the nearest segment, fails in a specific and common way: on a pair of
parallel streets, one noisy fix lands closer to the wrong road, and the walker
appears to teleport across the block and back. A single bad blip corrupts the
match.

StreetLens keeps a deliberately naive nearest-snap matcher (`baseline.ts`) for
exactly one reason: to prove this failure. `scripts/test-matching-hmm.mjs`
asserts that the baseline flips on parallel streets while the real matcher does
not. The baseline is a regression guard, never a runtime fallback.

## The idea: treat the true street as hidden

The real matcher is a **Newson-Krumm Hidden Markov Model** (Newson and Krumm,
2009), in `lib/matching/hmm.ts`. The insight is to stop trusting any single GPS
point and instead ask for the most probable **sequence** of streets that
explains the whole track.

The true segment you were on is a hidden state. Each GPS fix is a noisy
observation of it. The model scores two things:

- **Emission: does this fix look like it came from this segment?** The farther
  a segment sits from the raw fix, the less likely it emitted it. Emission is a
  Gaussian on the perpendicular distance from the fix to the segment
  (`logEmission`, `hmm.ts:300`). The noise scale is `sigmaZMeters = 10`
  (`DEFAULT_SIGMA_Z_M`, `hmm.ts:70`). Newson and Krumm fit about 4 m to car GPS;
  a phone carried by hand is noisier, so the default is 10 m.

- **Transition: could a walker really move from this segment to that one?** A
  step is only allowed between adjacent segments (ones that share an endpoint
  node in the graph). Among allowed steps, the model penalizes the gap between
  the straight-line distance and the actual on-network route distance
  (`logTransition`, `hmm.ts:331`), with decay scale `betaMeters = 2.0`
  (`DEFAULT_BETA_M`, `hmm.ts:72`). This is what makes a jump to a parallel
  street expensive: it is a short hop in a straight line but a long detour along
  real streets. The transition encodes a simple truth, that people walk
  continuous paths.

**Viterbi** (`viterbi`, `hmm.ts:445`) then finds the single most probable path
through all the fixes at once. Because the decision is made over the whole
sequence, one bad fix cannot flip the match. The neighbors on either side hold
it in place.

## The parameters

Every default lives in `hmm.ts` and is documented in `lib/matching/README.md`.
The ones that shape the result:

| Parameter | Default | Role |
|---|---|---|
| `sigmaZMeters` | 10 m | GPS emission noise. Consumer phone in a low-rise grid. |
| `betaMeters` | 2.0 m | Transition decay on the route-versus-straight-line gap. |
| `gateMeters` | 30 m | A fix farther than this from every segment yields no candidates and is cut. |
| `maxCandidates` | 5 | Candidate segments kept per fix, nearest first. |
| `maxAccuracyMeters` | 25 m | Fixes reporting worse accuracy are dropped in preprocessing. |
| `minStepMeters` | 2 m | Consecutive fixes closer than this are dropped as standing still (the last is always kept). |
| `maxGapSeconds` | 30 s | A time hole larger than this forces a fresh sub-trajectory. |
| `junctionRadiusM` | 20 m | A frame within this of a segment endpoint is flagged near a junction. |

## StreetLens specifics

**A fast spatial index.** The matcher works over the entire street network of
the cantón of Escazú, which is 1,457 segments in `data/segments.geojson`. To
find the handful of candidate segments near each fix without scanning all of
them, the graph is indexed with an [rbush](https://github.com/mourner/rbush)
R-tree (`graph.ts:12`, queried in `nearbySegments`, `graph.ts:186`). A capture
walk anywhere in the canton pins to real segments.

**Junctions are handled with care.** Near an intersection, two segments meet and
the evidence is genuinely ambiguous. A frame within `junctionRadiusM` (20 m) of
a segment's start or end node is flagged `nearJunction` (`hmm.ts:1154`). That
flag rides through the whole pipeline (persisted as `near_junction` in the
capture schema) so ambiguous frames can be scored cautiously rather than treated
as confident evidence.

**Gaps are never bridged.** When the GPS record has an honest hole, the matcher
refuses to guess across it. `viterbi` cuts the track into sub-trajectories on any
of three failures: a fix with zero candidates (off-network or beyond the gate), a
time gap larger than `maxGapSeconds`, or a column where every transition is
impossible (a teleport the network cannot connect). Each cut is reported as an
`UnmatchedSpan` (`hmm.ts:434`).

**Frames are placed by time.** The matcher solves the path from GPS fixes, then
places each captured frame along that path by interpolating on its timestamp
between the two bracketing fixes (`attributeFrameToRoute`, `hmm.ts:1122`).
`attributeFrames` maps every frame to `{ segmentId, nearJunction }`.

**A frame it cannot place is refused, not invented.** A frame that falls inside
an unmatched span maps to `segmentId: null` (`hmm.ts:1189`). Downstream, the
capture worker marks such a frame `no_segment_match` and excludes it
(`supabase/migrations/0015_capture_worker.sql`). The system would rather drop a
frame than assign it to a street it was not on.

## The matcher owns "where," and only the matcher

This separation is deliberate and enforced. The map matcher is the single
authority on location. The vision model is never allowed to assert where a frame
was taken. It can say what it sees; it cannot say where it was. The capture
observation the model produces carries no `segmentId` and no `nearJunction`
field at all, and the pipeline that runs the model has no permission to write
location back onto a frame (`supabase/migrations/0015_capture_worker.sql`). Where
a frame was is a fact the GPS track and the matcher decide, and nothing else gets
a vote.

## Where to read next

- [cv-funnel.md](cv-funnel.md) for the full funnel this matcher sits inside,
  including how matched frames roll up into per-segment lens scores.
- [keyframe-extraction.md](keyframe-extraction.md) for how the frames and the
  GPS track that feed this matcher are produced on the phone.
- `lib/matching/README.md` in the source tree for the parameter reference.
