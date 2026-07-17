/**
 * Map-matching contract: turning a raw GPS track into "which street, when".
 *
 * THIS FILE IS THE INTERFACE AND IS AUTHORITATIVE. `lib/matching/baseline.ts`
 * is a deliberately naive first implementation; the HMM matcher (unit
 * unit-hmm-map-matching) replaces it by swapping the default export in
 * `lib/matching/index.ts`. Nothing outside this directory may import a matcher
 * implementation directly — import from `lib/matching` and you get whichever
 * one is current, with no call-site churn on the swap.
 *
 * Types only; safe to import anywhere.
 */

import type { LineString } from "geojson";
import type { TrackPoint } from "@/lib/capture/types";

/**
 * One continuous pass along one segment.
 *
 * A track that goes up a street, turns around and comes back produces TWO
 * traversals of the same `segmentId`, not one merged span — which pass a frame
 * belongs to is exactly what tells us which side of the street was filmed.
 */
export type SegmentTraversal = {
  segmentId: string;
  /** Epoch ms of the first fix matched to this pass. */
  tEnter: number;
  /** Epoch ms of the last fix matched to this pass. */
  tExit: number;
  /** Metres travelled along the segment during this pass. */
  lengthM: number;
  /** Frame seqs captured during this pass (empty when matching without frames). */
  frameSeqs: number[];
  /**
   * The subset of `frameSeqs` near a junction. Junction-sensitive rubric items
   * (curb_ramp, crossing_safety) are read from these frames; mid-block items
   * are read from the rest.
   */
  nearJunctionSeqs: number[];
};

/** A stretch of time the matcher could not place on the network. */
export type UnmatchedSpan = {
  tStart: number;
  tEnd: number;
};

export type MatchResult = {
  /** Chronological by `tEnter`. */
  traversals: SegmentTraversal[];
  /** Gaps: signal loss, off-network travel, or a fix beyond the gate. */
  unmatchedSpans: UnmatchedSpan[];
  /** The travelled route as a line, for display and debugging. */
  routeLine: LineString;
};

/** The minimum a matcher needs to know about a frame: when it was shot. */
export type FrameTime = {
  seq: number;
  /** Epoch ms, UTC. */
  t: number;
};

/** One candidate street the matcher may snap to. */
export type MatchSegment = {
  id: string;
  /** [lng, lat] positions — GeoJSON order, always. */
  coordinates: [number, number][];
};

export type MatchOptions = {
  /**
   * Max snap distance in metres. A fix further than this from every segment is
   * unmatched rather than forced onto the nearest street. Default 30 m —
   * roughly consumer-GPS error in a low-rise street grid.
   */
  gateMeters?: number;
  /**
   * Discard a run of fewer than this many consecutive fixes on one segment.
   * Kills the flicker where a noisy fix snaps to a parallel street for one
   * sample. Default 2.
   */
  minRunFixes?: number;
  /**
   * A frame within this distance of a segment endpoint is `nearJunction`.
   * Default 20 m.
   */
  junctionRadiusM?: number;
  /**
   * Frames to attribute during matching. Supplying them populates
   * `frameSeqs`/`nearJunctionSeqs`; without them those stay empty.
   */
  frames?: FrameTime[];
  /**
   * Candidate segments. Defaults to `data/segments.geojson` (loaded lazily,
   * server-side only). Inject explicitly in tests and for other datasets.
   */
  segments?: MatchSegment[];
};

/**
 * Match a track to the street network.
 *
 * The one function every matcher implements. Implementations must be pure with
 * respect to their inputs (given `opts.segments`, no I/O) and must never throw
 * on a plausible-but-bad track: an unmatched track returns zero traversals and
 * one unmatched span, not an error.
 */
export type MatchTrack = (track: TrackPoint[], opts?: MatchOptions) => MatchResult;

/** Where one frame landed on the network. */
export type FrameAttributionResult = {
  segmentId: string | null;
  nearJunction: boolean;
};

/**
 * Invert a MatchResult into a per-frame lookup.
 *
 * EVERY input frame gets an entry. A frame shot during an unmatched span is
 * present with `segmentId: null` — silently dropping it would make coverage
 * look better than it is.
 */
export type AttributeFrames = (
  match: MatchResult,
  frames: FrameTime[],
) => Map<number, FrameAttributionResult>;
