/**
 * Map matching — the public entry point.
 *
 * Import from HERE, never from an implementation file. The active matcher is
 * chosen on the two lines below; unit-hmm-map-matching swaps `./baseline` for
 * `./hmm` and every call site keeps working because both satisfy
 * `lib/matching/types.ts`.
 *
 *   import { matchTrack, attributeFrames } from "@/lib/matching";
 *
 * `matchTrack` is server-side by default (it lazily reads
 * `data/segments.geojson`). Pass `opts.segments` to use it anywhere.
 */

export type {
  AttributeFrames,
  FrameAttributionResult,
  FrameTime,
  MatchOptions,
  MatchResult,
  MatchSegment,
  MatchTrack,
  SegmentTraversal,
  UnmatchedSpan,
} from "./types";

// The active implementation: the Newson-Krumm HMM (see hmm.ts, and README.md
// for the parameters). `baseline.ts` stays in the tree deliberately — it is the
// regression guard in scripts/test-matching-hmm.mjs, where the parallel-street
// case asserts that the naive matcher DOES flip where the HMM does not.
export { matchTrack, attributeFrames } from "./hmm";
export type { HmmOptions } from "./hmm";
