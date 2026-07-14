import type { ExpressionSpecification } from "maplibre-gl";
// Type-only import: erased at build time, so lib/segments' fs usage never
// reaches the client bundle.
import type { ScoreLayer } from "@/lib/segments";

/*
 * Score-layer visual encoding — sealed from docs/design-direction.md and
 * advisor rev 2. Semantics: HIGH = GOOD for every layer. Each ramp is
 * colorblind-safe and paired with a redundant line-WIDTH channel.
 *
 * value0 = worst (score 0), value100 = best (score 100). These are asserted
 * explicitly per layer so the direction cannot silently regress.
 */

/** Client-safe layer order (mirrors SCORE_LAYERS without importing the fs adapter). */
export const LAYER_ORDER: ScoreLayer[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
];

type RampStop = { at: number; hex: string };

export const RAMP: Record<ScoreLayer, RampStop[]> = {
  // { value0: #C0472B clay, value100: #0E7C66 teal } — teal→amber→clay, high=good
  overall: [
    { at: 0, hex: "#C0472B" },
    { at: 50, hex: "#E8B84B" },
    { at: 100, hex: "#0E7C66" },
  ],
  // { value0: #FFE945 pale yellow (barriers), value100: #00204D deep Cividis blue (accessible) }
  accessibility: [
    { at: 0, hex: "#FFE945" },
    { at: 50, hex: "#7C7B78" },
    { at: 100, hex: "#00204D" },
  ],
  // { value0: #C7C13B dull yellow (flood-prone), value100: #21808C blue-teal (well-drained) }
  drainage: [
    { at: 0, hex: "#C7C13B" },
    { at: 50, hex: "#4CA377" },
    { at: 100, hex: "#21808C" },
  ],
  // { value0: #DDE3CE pale bone (exposed), value100: #14532D canopy green (shaded) }
  shade: [
    { at: 0, hex: "#DDE3CE" },
    { at: 50, hex: "#6E9463" },
    { at: 100, hex: "#14532D" },
  ],
};

/** Width channel: lower score = thicker line (surfaces problems). Legend explains it. */
const WIDTH_AT_0 = 6;
const WIDTH_AT_100 = 2.5;

function scoreProp(layer: ScoreLayer): string {
  return `score_${layer}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((c) => Math.round(c).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Sample a layer ramp at an arbitrary 0–100 value (used for legend swatches). */
export function sampleRamp(layer: ScoreLayer, value: number): string {
  const stops = RAMP[layer];
  const v = Math.max(0, Math.min(100, value));
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].at) {
      lo = stops[i - 1];
      hi = stops[i];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = (v - lo.at) / span;
  const a = hexToRgb(lo.hex);
  const b = hexToRgb(hi.hex);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/** Representative line width for a 0–100 value (legend width cue + parity with map). */
export function widthForValue(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return WIDTH_AT_0 + (WIDTH_AT_100 - WIDTH_AT_0) * (v / 100);
}

/** MapLibre line-color expression for the active layer. */
export function lineColorExpression(layer: ScoreLayer): ExpressionSpecification {
  const stops = RAMP[layer];
  const prop = scoreProp(layer);
  return [
    "interpolate",
    ["linear"],
    ["get", prop],
    ...stops.flatMap((s) => [s.at, s.hex] as [number, string]),
  ] as unknown as ExpressionSpecification;
}

/** MapLibre line-width expression: score-driven, thicker when the hover state is set. */
export function lineWidthExpression(layer: ScoreLayer): ExpressionSpecification {
  const prop = scoreProp(layer);
  const base: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["get", prop],
    0,
    WIDTH_AT_0,
    100,
    WIDTH_AT_100,
  ] as unknown as ExpressionSpecification;
  return [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    ["+", base, 2],
    base,
  ] as unknown as ExpressionSpecification;
}

/** Explicit legend value bins (never color-only encoding). */
export const BINS = [
  { key: "excellent", min: 80, max: 100, mid: 90 },
  { key: "good", min: 60, max: 79, mid: 70 },
  { key: "fair", min: 40, max: 59, mid: 50 },
  { key: "poor", min: 0, max: 39, mid: 20 },
] as const;

export type LegendBinKey = (typeof BINS)[number]["key"];

/*
 * Client-safe mirror of the adapter's placeholder rubric synthesis, so the
 * detail panel can build a breakdown from the clicked feature's props without
 * importing lib/segments (which is server-only). Both are placeholder-grade
 * until real field data lands; the parity is intentional and documented.
 */
export const RUBRIC_ITEMS: Record<ScoreLayer, string[]> = {
  overall: ["surface", "width", "obstruction"],
  accessibility: ["ramp", "tactile", "crossing"],
  drainage: ["grate", "slope", "ponding"],
  shade: ["canopy", "awning", "exposure"],
};

export function seedFromId(id: string): number {
  return id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

export function placeholderItemScore(
  score: number,
  seed: number,
  index: number,
): number {
  const jitter = ((seed + index * 37) % 21) - 10;
  return Math.max(0, Math.min(100, Math.round(score + jitter)));
}

/*
 * Muted basemap palette (warm-neutral land, soft parks, muted water).
 * Applied as a post-load transform over Liberty. Dark = near-black warm base.
 */
export const BASEMAP = {
  light: {
    land: "#efece3",
    landuse: "#e7e4d8",
    park: "#dbe3cf",
    water: "#c8d4d2",
    road: "#f7f5ef",
    roadMinor: "#f1eee6",
    building: "#e6e2d6",
    boundary: "#cfccc0",
  },
  dark: {
    land: "#16160f",
    landuse: "#1a1a12",
    park: "#1c2417",
    water: "#10201f",
    road: "#22221a",
    roadMinor: "#1c1c14",
    building: "#1e1e15",
    boundary: "#2c2c22",
  },
} as const;
