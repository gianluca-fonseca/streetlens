/**
 * Continuity smoothing for continuous street infrastructure.
 *
 * WHY THIS EXISTS. A sidewalk (or bike lane) does not blink out for ten metres
 * between two frames that clearly show it — nor does it vanish for a stretch of
 * occluded / out-of-view frames and then reappear on the same road. An oblique
 * or blurred frame that reports "absent" between present neighbors is
 * measurement noise, not a gap in the built environment. The deterministic
 * baseline rollup must downweight that dissent before the confidence-weighted
 * median, rather than waiting for the synthesis prose pass to paper over it.
 *
 * WHAT IT MAY TOUCH. Only PRESENCE-type items that describe continuous built
 * infrastructure (see CONTINUOUS_INFRASTRUCTURE_ITEMS). Transient or point
 * features — ponding, obstructions, drains, junction ramps — are NEVER smoothed.
 *
 * TWO-TIER INFERENCE (owner extension):
 *   A. Classify each absent reading as CONFIDENT-ABSENT (confidence ≥ threshold)
 *      vs WEAK-ABSENT (low confidence — occlusion / out-of-view / crop).
 *   B. Tier 1 SANDWICH: 1–2 dissenting frames (even confident-absent) between
 *      confident-present neighbors in the same segment run → inferred-present.
 *   C. Tier 2 BOOKEND BRIDGE: confident-present bookends at any distance within
 *      the run flip ALL intervening WEAK-absents; a CONFIDENT-absent breaks the
 *      bridge. Bridges never cross segment boundaries.
 *   D. Edges of a run (no bookend on one side) never flip. Genuine absent runs
 *      (confident-absent bookend-to-bookend) never flip. Everything inferred is
 *      marked inferred: true.
 *
 * Pure: readings in, smoothed readings out. No I/O, no clock.
 */

import {
  RUBRIC_ITEM_RESPONSE_TYPES,
  type RubricItemKey,
} from "./types";

/**
 * Continuous built infrastructure. Presence (boolean) plus closely-kin graded
 * attributes of the same continuous object. Explicitly excluded: standing_water
 * (ponding), obstruction_free (transient), drain_present (point), curb_ramp /
 * crossing_safety (junction-local), canopy/shade/lighting (variable canopy).
 */
export const CONTINUOUS_INFRASTRUCTURE_ITEMS: ReadonlySet<RubricItemKey> = new Set([
  "sidewalk_present",
  "sidewalk_width",
  "surface_condition",
  "bike_lane_present",
  "bike_separation",
  "bike_surface",
]);

/** Neighbor / bookend must be at least this confident to anchor an inference. */
export const CONTINUITY_NEIGHBOR_CONFIDENCE = 0.6;

/**
 * Absent readings at or above this confidence are CONFIDENT-ABSENT (genuinely
 * interrupted infrastructure). Below → WEAK-ABSENT (occlusion / out-of-view).
 */
export const CONTINUITY_ABSENT_CONFIDENCE = 0.7;

/** Longest dissenting run that Tier 1 sandwich may flip (1 or 2 frames). */
export const CONTINUITY_MAX_GAP = 2;

/** Inferred confidence = min(anchor confidences) × this factor. */
export const CONTINUITY_INFERRED_CONFIDENCE_FACTOR = 0.5;

/** One frame's reading for a single rubric item, as continuity sees it. */
export type ContinuityReading = {
  seq: number;
  frameId: string;
  value: number;
  confidence: number;
};

/** After smoothing: same reading, optionally flagged as inferred from neighbors. */
export type SmoothedContinuityReading = ContinuityReading & {
  inferred: boolean;
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Present for continuity anchors: boolean yes, or graded ≥ 2. */
export function isContinuityPresent(key: RubricItemKey, value: number): boolean {
  if (RUBRIC_ITEM_RESPONSE_TYPES[key] === "boolean") return value > 0;
  return value >= 2;
}

/** High-confidence present — eligible as sandwich neighbor or bookend. */
export function isConfidentPresent(
  key: RubricItemKey,
  reading: ContinuityReading,
): boolean {
  return (
    isContinuityPresent(key, reading.value) &&
    reading.confidence >= CONTINUITY_NEIGHBOR_CONFIDENCE
  );
}

/**
 * Absent (or strongly lower) with high confidence — breaks Tier 2 bridges.
 * Weak absents (low confidence) are treated as occlusion / out-of-view.
 */
export function isConfidentAbsent(
  key: RubricItemKey,
  reading: ContinuityReading,
): boolean {
  return (
    !isContinuityPresent(key, reading.value) &&
    reading.confidence >= CONTINUITY_ABSENT_CONFIDENCE
  );
}

export function isWeakAbsent(
  key: RubricItemKey,
  reading: ContinuityReading,
): boolean {
  return (
    !isContinuityPresent(key, reading.value) &&
    reading.confidence < CONTINUITY_ABSENT_CONFIDENCE
  );
}

/**
 * Value to write when reclassifying a dissent as inferred-present.
 * Boolean → 1; graded → the more conservative (min) of the two anchors.
 */
function inferredPresentValue(
  key: RubricItemKey,
  left: ContinuityReading,
  right: ContinuityReading,
): number {
  if (RUBRIC_ITEM_RESPONSE_TYPES[key] === "boolean") return 1;
  return Math.min(left.value, right.value);
}

function applyInference(
  out: SmoothedContinuityReading[],
  indices: readonly number[],
  key: RubricItemKey,
  left: ContinuityReading,
  right: ContinuityReading,
): void {
  const nextValue = inferredPresentValue(key, left, right);
  const nextConfidence = round3(
    Math.min(left.confidence, right.confidence) * CONTINUITY_INFERRED_CONFIDENCE_FACTOR,
  );
  for (const j of indices) {
    if (out[j].inferred) continue; // already flipped by an earlier tier
    out[j] = {
      ...out[j],
      value: nextValue,
      confidence: nextConfidence,
      inferred: true,
    };
  }
}

/**
 * Tier 1 — SANDWICH: runs of 1–2 consecutive non-present readings between
 * confident-present neighbors flip to inferred-present (even if confident-absent).
 */
function applySandwichTier(
  key: RubricItemKey,
  sorted: readonly ContinuityReading[],
  out: SmoothedContinuityReading[],
): void {
  let i = 0;
  while (i < sorted.length) {
    if (isContinuityPresent(key, sorted[i].value)) {
      i += 1;
      continue;
    }

    const start = i;
    while (i < sorted.length && !isContinuityPresent(key, sorted[i].value)) {
      i += 1;
    }
    const end = i;
    const runLen = end - start;

    if (runLen < 1 || runLen > CONTINUITY_MAX_GAP) continue;

    const left = start > 0 ? sorted[start - 1] : null;
    const right = end < sorted.length ? sorted[end] : null;
    if (!left || !right) continue;
    if (!isConfidentPresent(key, left) || !isConfidentPresent(key, right)) continue;

    const indices = [];
    for (let j = start; j < end; j += 1) indices.push(j);
    applyInference(out, indices, key, left, right);
  }
}

/**
 * Tier 2 — BOOKEND BRIDGE: between consecutive confident-present anchors at any
 * distance, flip intervening WEAK-absents. A CONFIDENT-absent breaks the bridge.
 * Operates on post-Tier-1 values so short sandwiches can help form longer bridges.
 */
function applyBookendBridge(
  key: RubricItemKey,
  out: SmoothedContinuityReading[],
): void {
  const anchors: number[] = [];
  for (let i = 0; i < out.length; i += 1) {
    if (isConfidentPresent(key, out[i])) anchors.push(i);
  }

  for (let a = 0; a < anchors.length - 1; a += 1) {
    const leftIdx = anchors[a];
    const rightIdx = anchors[a + 1];
    if (rightIdx - leftIdx <= 1) continue;

    let bridgeBroken = false;
    const weakIndices: number[] = [];
    for (let j = leftIdx + 1; j < rightIdx; j += 1) {
      if (isContinuityPresent(key, out[j].value)) continue;
      if (isConfidentAbsent(key, out[j])) {
        bridgeBroken = true;
        break;
      }
      // weak-absent (or already-inferred still flagged — skip if present after Tier 1)
      if (isWeakAbsent(key, out[j])) weakIndices.push(j);
    }
    if (bridgeBroken || weakIndices.length === 0) continue;

    applyInference(out, weakIndices, key, out[leftIdx], out[rightIdx]);
  }
}

/**
 * Smooth one item's ordered readings within a single segment traversal.
 *
 * Input must already be filtered to the item's source frames (junction vs
 * mid-block), non-null values only, and sorted by seq ascending. Deterministic.
 */
export function smoothContinuityReadings(
  key: RubricItemKey,
  readings: readonly ContinuityReading[],
): SmoothedContinuityReading[] {
  if (!CONTINUOUS_INFRASTRUCTURE_ITEMS.has(key) || readings.length === 0) {
    return readings.map((r) => ({ ...r, inferred: false }));
  }

  const sorted = [...readings].sort(
    (a, b) => a.seq - b.seq || a.frameId.localeCompare(b.frameId),
  );
  const out: SmoothedContinuityReading[] = sorted.map((r) => ({ ...r, inferred: false }));

  applySandwichTier(key, sorted, out);
  applyBookendBridge(key, out);

  return out;
}

/**
 * Frame ids whose reading for `key` was continuity-inferred after smoothing.
 * Used by the review UI to mark "inferred from neighbors" honestly.
 */
export function inferredFrameIdsForItem(
  key: RubricItemKey,
  readings: readonly ContinuityReading[],
): ReadonlySet<string> {
  const smoothed = smoothContinuityReadings(key, readings);
  return new Set(smoothed.filter((r) => r.inferred).map((r) => r.frameId));
}

/**
 * Which continuous-infrastructure keys were continuity-inferred for one frame,
 * given its segment-mates (already override-applied, usable, mid-block). Pure
 * helper for the review workbench marker — same rules as the rollup path.
 */
export function inferredKeysForFrame(
  frameId: string,
  segmentMates: readonly {
    frameId: string;
    seq: number;
    items: Partial<Record<RubricItemKey, { value: number | null; confidence: number }>>;
  }[],
): ReadonlySet<RubricItemKey> {
  const out = new Set<RubricItemKey>();
  for (const key of CONTINUOUS_INFRASTRUCTURE_ITEMS) {
    const readings: ContinuityReading[] = [];
    for (const mate of segmentMates) {
      const item = mate.items[key];
      if (!item || item.value === null || item.value === undefined) continue;
      if (!Number.isFinite(item.value)) continue;
      readings.push({
        seq: mate.seq,
        frameId: mate.frameId,
        value: item.value,
        confidence: item.confidence,
      });
    }
    if (inferredFrameIdsForItem(key, readings).has(frameId)) out.add(key);
  }
  return out;
}
