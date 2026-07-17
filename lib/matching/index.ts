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

// The active implementation. BASELINE today — see baseline.ts for what it
// knowingly gets wrong and why the HMM replaces it.
export { matchTrack, attributeFrames } from "./baseline";
