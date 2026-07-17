/**
 * Per-frame observations → one staged rollup per segment.
 *
 * THESE ARE STAGED RESULTS FOR HUMAN REVIEW. Nothing here touches demo-audits,
 * the community store, or live map data — a rollup lands in
 * capture_segment_rollups and waits for a person. Wiring an approved capture
 * into the map is the review unit's job, deliberately not this one's.
 *
 * Pure: observations in, rollups out. No I/O, no clock.
 */

import {
  RUBRIC_ITEM_KEYS,
  type RubricItemKey,
  type CaptureObservationItem,
} from "./types";
import {
  confidenceWeightedMedian,
  lensScoresFromItems,
  normalizeItemValue,
  type LensScores,
} from "./scoring";

/**
 * The items read from junction frames rather than mid-block ones.
 *
 * THIS IS A CONTRACT RULE, NOT A TUNING CHOICE. lib/capture/types.ts, on
 * FrameAttribution.nearJunction: "Junction-sensitive items (curb_ramp,
 * crossing_safety) are read from these frames; the rest are not."
 *
 * So frame selection is per ITEM, not per frame. A blanket "exclude junction
 * frames" would be simpler and would silently source curb_ramp and
 * crossing_safety from exactly the mid-block frames that cannot see a crossing —
 * scoring the two accessibility-critical items from photos of the wrong thing.
 * The inverse matters just as much: a photo taken at a corner shows the
 * junction, not the mid-block sidewalk, so it must not score sidewalk_width.
 */
export const JUNCTION_ITEMS: ReadonlySet<RubricItemKey> = new Set<RubricItemKey>([
  "curb_ramp",
  "crossing_safety",
]);

/** One observation as the rollup needs it. Mirrors the 0015 list RPC's shape. */
export type RollupObservation = {
  frameId: string;
  segmentId: string | null;
  model: string;
  items: Record<RubricItemKey, CaptureObservationItem>;
  usable: boolean;
  escalated: boolean;
  nearJunction: boolean;
};

/** What one item's median came out as, and how much evidence stood behind it. */
export type ItemMedian = {
  value: number | null;
  confidence: number | null;
  /** Frames that contributed a non-null value. */
  frames: number;
};

export type SegmentRollup = {
  segmentId: string;
  scores: LensScores;
  itemMedians: Record<string, ItemMedian>;
  /** Usable, contributing frames / frames attributed to this segment, 0-1. */
  coverage: number;
  /** Mean of the per-item confidences that produced a median. Null if none did. */
  confidence: number | null;
};

/**
 * Collapse an escalated frame's two observations into one.
 *
 * A frame that escalated has a row per model (capture_observations is unique on
 * (frame_id, model)), and counting both would let one frame vote twice — with
 * the two votes disagreeing, which is precisely why it escalated. The stronger
 * model's answer is the answer; the cheap one stays on the row for A/B and cost
 * attribution.
 */
function oneObservationPerFrame(observations: readonly RollupObservation[]): RollupObservation[] {
  const byFrame = new Map<string, RollupObservation>();
  for (const obs of observations) {
    const existing = byFrame.get(obs.frameId);
    if (!existing || (obs.escalated && !existing.escalated)) {
      byFrame.set(obs.frameId, obs);
    }
  }
  return [...byFrame.values()];
}

/**
 * Aggregate one session's observations into per-segment rollups.
 *
 * Observations with no segment are dropped: they were never placed on the
 * network, so there is nothing to roll them up to.
 */
export function computeRollups(observations: readonly RollupObservation[]): SegmentRollup[] {
  const deduped = oneObservationPerFrame(observations);

  const bySegment = new Map<string, RollupObservation[]>();
  for (const obs of deduped) {
    if (!obs.segmentId) continue;
    const bucket = bySegment.get(obs.segmentId) ?? [];
    bucket.push(obs);
    bySegment.set(obs.segmentId, bucket);
  }

  const rollups: SegmentRollup[] = [];

  for (const [segmentId, all] of [...bySegment.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const usable = all.filter((o) => o.usable);

    const itemMedians: Record<string, ItemMedian> = {};
    const normalized: Partial<Record<RubricItemKey, number | null>> = {};
    const itemConfidences: number[] = [];
    const contributingFrames = new Set<string>();

    for (const key of RUBRIC_ITEM_KEYS) {
      // Per-item frame selection — see JUNCTION_ITEMS above.
      const wantJunction = JUNCTION_ITEMS.has(key);
      const sources = usable.filter((o) => o.nearJunction === wantJunction);

      const entries: { value: number; confidence: number; frameId: string }[] = [];
      for (const obs of sources) {
        const item = obs.items?.[key];
        if (!item || item.value === null || item.value === undefined) continue;
        if (!Number.isFinite(item.value)) continue;
        entries.push({
          value: item.value,
          confidence: item.confidence,
          frameId: obs.frameId,
        });
      }

      if (entries.length === 0) {
        itemMedians[key] = { value: null, confidence: null, frames: 0 };
        normalized[key] = null;
        continue;
      }

      const median = confidenceWeightedMedian(entries);
      const meanConfidence =
        entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;

      itemMedians[key] = {
        value: median,
        confidence: Math.round(meanConfidence * 1000) / 1000,
        frames: entries.length,
      };
      normalized[key] = normalizeItemValue(key, median);

      if (median !== null) {
        itemConfidences.push(meanConfidence);
        for (const e of entries) contributingFrames.add(e.frameId);
      }
    }

    const scores = lensScoresFromItems(normalized);

    // Coverage against frames ATTRIBUTED, not frames usable: a segment where
    // half the frames were ruined by motion blur has genuinely poor coverage,
    // and dividing by the usable ones would hide exactly that.
    const coverage = all.length === 0 ? 0 : contributingFrames.size / all.length;

    const confidence =
      itemConfidences.length === 0
        ? null
        : Math.round(
            (itemConfidences.reduce((a, b) => a + b, 0) / itemConfidences.length) * 1000,
          ) / 1000;

    rollups.push({
      segmentId,
      scores,
      itemMedians,
      coverage: Math.round(Math.max(0, Math.min(1, coverage)) * 1000) / 1000,
      confidence,
    });
  }

  return rollups;
}
