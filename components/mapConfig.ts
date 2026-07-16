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
  "bike",
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
  // { value0: #E8D9C4 pale sand (no/poor bike infra), value100: #8A4B2D deep copper (protected) }
  // Monotonic warm ramp (sand → tan → copper). Distinct from drainage's yellow
  // end (#C7C13B): the copper hue is orange-brown and only one layer is active
  // at a time, with the redundant width channel as backup for CVD.
  bike: [
    { at: 0, hex: "#E8D9C4" },
    { at: 50, hex: "#C88C5E" },
    { at: 100, hex: "#8A4B2D" },
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

/* ------------------------------------------------------------------ *
 * Community / import segments (contract v3, u7)
 *
 * A SEPARATE, fixed-color, dashed neutral casing — deliberately NOT a score
 * ramp. Unverified community contributions must not borrow a score color until
 * a field audit verifies them (advisor ruling 1). Warm neutral grey from the
 * design direction (#6B7069 / #9AA097). The score-ramp layers stay untouched.
 * ------------------------------------------------------------------ */

export const COMMUNITY_CASING = {
  /** Warm neutral grey; the lighter step reads better on the dark basemap. */
  color: "#6B7069",
  colorDark: "#9AA097",
  /** Dashed so it reads as provisional / pending field verification. */
  dash: [2, 1.6] as [number, number],
  width: 3,
  widthSelected: 4.5,
} as const;

/** Sources rendered with the community casing rather than the score ramp. */
const COMMUNITY_SOURCES = ["community", "import"] as const;

/** Score-ramp layers draw everything EXCEPT community/import features. */
export const RAMP_LAYER_FILTER = [
  "!",
  ["in", ["get", "source"], ["literal", COMMUNITY_SOURCES]],
] as unknown as ExpressionSpecification;

/** The community casing layer draws ONLY community/import features. */
export const COMMUNITY_LAYER_FILTER = [
  "in",
  ["get", "source"],
  ["literal", COMMUNITY_SOURCES],
] as unknown as ExpressionSpecification;

/** Community casing width, thicker when this feature is selected. */
export const communityWidthExpression = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  COMMUNITY_CASING.widthSelected,
  COMMUNITY_CASING.width,
] as unknown as ExpressionSpecification;

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
  bike: ["lane", "separation", "connectivity"],
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
 * Basemap palette retuned to rev-5 PAPER grounds so the live map reads as a
 * plate in the document (FIGURE 1): the land is the paper ground, roads step up
 * to the brighter paper-white, land-use/parks/water are quiet desaturated paper
 * tints (rev-4 road-yellow and saturated park-green retired), boundaries are the
 * hairline. Applied as a post-load transform over Liberty. Dark = inverted
 * paper. The sealed score RAMP stays the loud color on the page; these grounds
 * keep enough step for the ramps to stay legible. Mirror any change into
 * scripts/render-map-images.mjs BASEMAP verbatim and re-run `npm run render:maps`.
 */
export const BASEMAP = {
  light: {
    land: "#f3f1e9", // --paper: the page/mat ground
    landuse: "#eeebe1",
    park: "#e7e7d8", // faint cool paper-green (desaturated)
    water: "#dbe0dd", // cool paper-grey
    road: "#fbfaf6", // --paper-white: brightest, the plate
    roadMinor: "#f6f4ec",
    building: "#e5e1d5",
    boundary: "#dad5c7", // --hairline
  },
  dark: {
    land: "#14120c", // --paper (inverted)
    landuse: "#181610",
    park: "#161810", // faint dark paper-green
    water: "#101613", // cool dark
    road: "#1e1b14", // --paper-white (inverted): brightest
    roadMinor: "#181510",
    building: "#201d15",
    boundary: "#33302a", // --hairline
  },
} as const;

/* ------------------------------------------------------------------ *
 * 3D mode (u8) — native MapLibre terrain, always-on hillshade, and
 * OSM building extrusions. Presentational only: this block adds NO score
 * semantics and leaves RAMP + the line color/width expressions untouched.
 * Implements the ratified research sketch (AWS Terrarium DEM, coalesced
 * building heights) exactly.
 * ------------------------------------------------------------------ */

/** AWS Open Data Terrarium DEM — public-domain composite (USGS 3DEP/SRTM/GMTED
 * + Copernicus EU-DEM). `encoding: "terrarium"` is mandatory (MapLibre defaults
 * to mapbox). No SLA on the S3 bucket; acceptable for a subtle relief effect. */
export const TERRAIN = {
  sourceId: "terrain-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 15,
  /** Combined USGS/Copernicus credit, shown alongside the OSM/OpenFreeMap line. */
  attribution:
    'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrarium</a> (USGS 3DEP, SRTM, GMTED2010; Copernicus EU-DEM)',
  /** Vertical exaggeration when 3D is enabled — hilly Escazú reads well at ~1.4. */
  exaggeration: 1.4,
} as const;

/** Always-on hillshade layer id (subtle relief under the muted basemap). */
export const HILLSHADE_LAYER_ID = "terrain-hillshade";

/** Hillshade paint tuned to the warm muted palette so it never fights the score
 * ramps in 2D: low exaggeration, warm shadow/highlight, restrained alpha. */
export const HILLSHADE_PAINT = {
  light: {
    "hillshade-shadow-color": "rgba(25, 21, 16, 0.20)", // ink
    "hillshade-highlight-color": "rgba(251, 250, 246, 0.34)", // paper-white
    "hillshade-accent-color": "rgba(183, 176, 160, 0.10)", // hairline-strong
    "hillshade-exaggeration": 0.3,
  },
  dark: {
    "hillshade-shadow-color": "rgba(0, 0, 0, 0.42)",
    "hillshade-highlight-color": "rgba(241, 238, 227, 0.14)", // creme ink
    "hillshade-accent-color": "rgba(51, 48, 42, 0.20)", // hairline
    "hillshade-exaggeration": 0.4,
  },
} as const;

/** OSM building extrusions (reuse Liberty's `building-3d` fill-extrusion; fall
 * back to any building extrusion layer present). Visible ONLY in 3D mode. */
export const BUILDINGS = {
  /** Candidate layer ids in the Liberty style, most specific first. */
  layerIdCandidates: ["building-3d", "building"] as const,
  minzoom: 14,
  color: { light: "#e4e0d3", dark: "#221f16" } as const,
  opacity: 0.88,
  /** Coalesce the ~95% of Escazú footprints with no real height to a nicer
   * nominal box (9 m); keep genuinely tagged tall buildings/parts correct. */
  heightExpression: [
    "case",
    [">", ["get", "render_height"], 5],
    ["get", "render_height"],
    9,
  ] as unknown as ExpressionSpecification,
  baseExpression: ["get", "render_min_height"] as unknown as ExpressionSpecification,
} as const;
