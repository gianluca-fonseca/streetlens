/**
 * Public rubric vocabulary for /method and /rubric transparency pages.
 * Mirrors lib/capture/types.ts RUBRIC_ITEM_* without pulling the capture stack.
 */

import type { ScoreLayer } from "./types";

export type RubricResponseType = "boolean" | "scale_0_4" | "percent";

export type PublicRubricItem = {
  key: string;
  layer: Exclude<ScoreLayer, never>;
  response: RubricResponseType;
};

/** The 15 rubric v0.1 items in official order. */
export const PUBLIC_RUBRIC_ITEMS: readonly PublicRubricItem[] = [
  { key: "sidewalk_present", layer: "accessibility", response: "boolean" },
  { key: "sidewalk_width", layer: "accessibility", response: "scale_0_4" },
  { key: "surface_condition", layer: "accessibility", response: "scale_0_4" },
  { key: "curb_ramp", layer: "accessibility", response: "boolean" },
  { key: "obstruction_free", layer: "accessibility", response: "scale_0_4" },
  { key: "drain_present", layer: "drainage", response: "boolean" },
  { key: "standing_water", layer: "drainage", response: "scale_0_4" },
  { key: "curb_gutter", layer: "drainage", response: "scale_0_4" },
  { key: "canopy_cover", layer: "shade", response: "percent" },
  { key: "midday_shade", layer: "shade", response: "scale_0_4" },
  { key: "lighting", layer: "overall", response: "scale_0_4" },
  { key: "crossing_safety", layer: "overall", response: "scale_0_4" },
  { key: "bike_lane_present", layer: "bike", response: "boolean" },
  { key: "bike_separation", layer: "bike", response: "scale_0_4" },
  { key: "bike_surface", layer: "bike", response: "scale_0_4" },
] as const;

export const LENS_ORDER: ScoreLayer[] = [
  "accessibility",
  "drainage",
  "shade",
  "bike",
  "overall",
];
