/**
 * Rubric items → the five lens scores (0-100).
 *
 * WHY THIS IS NEW CODE AND NOT A FACTORING OF THE DEMO SCRIPT.
 * `scripts/generate-demo-audits.mjs` looks like the scorer to reuse, but it runs
 * the other way: it invents a lens score from geography (`scoreSegment`, lines
 * 180-221) and then derives plausible per-item answers from it (`itemResponse`,
 * lines 223-236). There is no items → lens function in there to lift. What it
 * does pin down is the two conventions this file must match exactly, so a CV
 * rollup and a human field audit mean the same thing by "72":
 *
 *   1. NORMALIZATION — the inverse of itemResponse (line 227-235):
 *        boolean    → 0 | 1        (already normalized)
 *        percent    → value / 100
 *        scale_0_4  → value / 4
 *   2. THE OVERALL COMPOSITE — line 206-208, byte-for-byte:
 *        overall = 0.45*accessibility + 0.30*drainage + 0.25*shade
 *      and bike stands alone (line 210-212: "Bike is its own lens").
 *
 * A CONSEQUENCE WORTH KNOWING. `lighting` and `crossing_safety` map to layer
 * "overall" in RUBRIC_ITEM_LAYERS, but the composite above does not read them —
 * in the demo script `overall` is derived from the other three lenses and the
 * two items are derived FROM it, never into it. So those two items are recorded
 * in `item_medians` and do not move `score_overall`. That is deliberate: the
 * point of the shared vocabulary (lib/capture/types.ts) is that score_overall is
 * comparable between a CV rollup and a field audit, and blending in two extra
 * items here would quietly make CV overalls mean something the demo/map
 * consumers do not. If overall should consume them, it changes in BOTH places.
 *
 * Pure and dependency-free: no I/O, no clock, safe to import anywhere.
 */

import {
  RUBRIC_ITEM_KEYS,
  RUBRIC_ITEM_LAYERS,
  RUBRIC_ITEM_RESPONSE_TYPES,
  type RubricItemKey,
} from "./types";

/** The five map lenses. */
export type LensKey = "overall" | "accessibility" | "drainage" | "shade" | "bike";

export const LENS_KEYS: readonly LensKey[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
  "bike",
] as const;

/**
 * The overall composite's weights. Mirrors generate-demo-audits.mjs:206-208.
 * `bike` is absent on purpose — it is its own lens, not part of the composite.
 */
export const OVERALL_WEIGHTS: Readonly<Record<"accessibility" | "drainage" | "shade", number>> =
  {
    accessibility: 0.45,
    drainage: 0.3,
    shade: 0.25,
  } as const;

/** Lens score, or null when no frame could assess that lens at all. */
export type LensScores = Record<LensKey, number | null>;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * One item's raw value → 0..1, by its rubric response type.
 *
 * Returns null for a null value: "not assessable from this frame" is a real
 * answer and must not be scored as a zero (lib/capture/types.ts is explicit
 * about this). Higher is always better, including `standing_water`, which the
 * rubric phrases as "No standing-water evidence".
 */
export function normalizeItemValue(key: RubricItemKey, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;

  switch (RUBRIC_ITEM_RESPONSE_TYPES[key]) {
    case "boolean":
      return value > 0 ? 1 : 0;
    case "percent":
      return Math.max(0, Math.min(1, value / 100));
    case "scale_0_4":
      return Math.max(0, Math.min(1, value / 4));
  }
}

/**
 * Per-item normalized values → the five lens scores.
 *
 * A lens with no assessable items scores null rather than 0 — "we could not
 * see" and "it is bad" are different claims and the map must not conflate them.
 * `overall` needs at least one of its three constituent lenses; the weights of
 * the lenses that are present are renormalized, so a segment with no drainage
 * evidence still gets an honest overall from accessibility and shade rather
 * than being dragged down by a lens that was never measured.
 */
export function lensScoresFromItems(
  normalized: Partial<Record<RubricItemKey, number | null>>,
): LensScores {
  const buckets = new Map<string, number[]>();

  for (const key of RUBRIC_ITEM_KEYS) {
    const v = normalized[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const lens = RUBRIC_ITEM_LAYERS[key];
    const bucket = buckets.get(lens) ?? [];
    bucket.push(v);
    buckets.set(lens, bucket);
  }

  const mean = (lens: string): number | null => {
    const values = buckets.get(lens);
    if (!values || values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const accessibility = mean("accessibility");
  const drainage = mean("drainage");
  const shade = mean("shade");
  const bike = mean("bike");

  // Renormalize over whichever constituent lenses were actually measured.
  let weightSum = 0;
  let weighted = 0;
  const parts: [number | null, number][] = [
    [accessibility, OVERALL_WEIGHTS.accessibility],
    [drainage, OVERALL_WEIGHTS.drainage],
    [shade, OVERALL_WEIGHTS.shade],
  ];
  for (const [value, weight] of parts) {
    if (value === null) continue;
    weighted += value * weight;
    weightSum += weight;
  }
  const overall = weightSum > 0 ? weighted / weightSum : null;

  const toScore = (v: number | null): number | null =>
    v === null ? null : Math.round(clamp(v * 100) * 100) / 100;

  return {
    overall: toScore(overall),
    accessibility: toScore(accessibility),
    drainage: toScore(drainage),
    shade: toScore(shade),
    bike: toScore(bike),
  };
}

/**
 * Confidence-weighted median of one item across frames.
 *
 * Median, not mean: one frame that hallucinates a 4 where three say 0 should
 * not move the answer, and with a handful of frames per segment that is a live
 * risk. Weighted by the model's own confidence, so a hedged read counts for
 * less than a certain one.
 *
 * The weighted median is the value at which cumulative weight crosses half the
 * total. Ties land on the lower value (the conservative read for a rubric where
 * higher is better). Entries with a null value are the caller's to exclude —
 * they mean "not assessable" and must never be interpolated into a number.
 */
export function confidenceWeightedMedian(
  entries: readonly { value: number; confidence: number }[],
): number | null {
  const usable = entries.filter(
    (e) => Number.isFinite(e.value) && Number.isFinite(e.confidence) && e.confidence > 0,
  );
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, e) => sum + e.confidence, 0);
  if (total <= 0) return null;

  const half = total / 2;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.confidence;
    if (cumulative >= half) return entry.value;
  }
  return sorted[sorted.length - 1]!.value;
}
