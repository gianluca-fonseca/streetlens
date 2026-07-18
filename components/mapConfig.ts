import type { ExpressionSpecification } from "maplibre-gl";
// Type-only import: erased at build time, so lib/segments' fs usage never
// reaches the client bundle.
import type { ScoreLayer } from "@/lib/segments";

/*
 * Score-layer visual encoding — rev 7, resealed. Semantics: HIGH = GOOD for
 * every layer. Each ramp is colorblind-safe and paired with a redundant
 * line-WIDTH channel.
 *
 * value0 = worst (score 0), value100 = best (score 100). These are asserted
 * explicitly per layer so the direction cannot silently regress.
 *
 * ── Why rev 7 replaced rev 2 (#28) ────────────────────────────────────────
 * The owner's ruling: the ramps were muddy and hard to read, and the seal was
 * lifted for exactly this change. Rev 2's real defect was that it ignored the
 * basemap it is painted on. BASEMAP is near-WHITE in light (land #fafafa, roads
 * #ffffff) and near-BLACK in dark (land #0a0a0a) — so a stop is only legible in
 * BOTH themes if its luminance sits in a middle band. Rev 2 broke that at both
 * ends: shade@0 #DDE3CE (pale bone) all but vanished on the light basemap, and
 * accessibility@100 #00204D vanished on the dark one.
 *
 * Rev 7 is therefore constructed rather than picked. Every stop is solved to a
 * TARGET RELATIVE LUMINANCE — 0.278 at score 0, 0.183 at 50, 0.118 at 100 — by
 * fixing the hue and saturation and binary-searching lightness. Three
 * consequences, all of them the point:
 *
 *   1. Legibility in both themes, by construction. The band was derived from
 *      the 3:1 non-text contrast floor against the extreme surfaces: L ≤ 0.30
 *      to clear white roads, L ≥ 0.111 to clear the near-black land. Every stop
 *      lands ≥3.06:1 on the light basemap and ≥2.92:1 on the dark one.
 *
 *   2. CVD safety without relying on hue. Luminance descends monotonically
 *      across all five ramps, so bad→good survives grayscale (≈1.95:1
 *      end-to-end) and any form of colour blindness. Hue and the width channel
 *      are redundant reinforcement, not the sole carrier — which is what rev 2's
 *      red/green overall ramp leaned on.
 *
 *   3. Maximum chroma at both ends. Bad is the LIGHT end and good is the DARK
 *      end, chosen to run WITH the physics rather than against it: saturated
 *      warm hues are naturally high-luminance and saturated cool hues naturally
 *      low, so red stays a vivid red at 0.278 instead of the muddy maroon it
 *      becomes when forced dark, and indigo/teal/forest stay rich at 0.118.
 *      That is where the "flashier" comes from — it is bought with saturation,
 *      not with brightness the basemap cannot afford.
 *
 * Each lens owns a distinct HUE FAMILY so a view is recognisable at a glance:
 * overall is the only multi-hue ramp (the traffic light, red low end), and the
 * other four are single-family journeys. Note bike deliberately left the old
 * copper for magenta: a warm rust high end meant the BEST bike streets rendered
 * in alarm-red, directly contradicting the overall lens the user just came from.
 *
 * Verified against the light and dark basemap at z12–z17 in a real browser, not
 * by intuition; screenshots in .planning/evidence/map-theme-ramps/.
 *
 * SEALED AGAIN at these values. scripts/test-score-color.mjs freezes the table
 * stop-for-stop, scripts/test-ramp-legibility.mjs re-derives the luminance band
 * and the monotonicity, and scripts/render-map-images.mjs mirrors it verbatim —
 * change one and you must change all three (then re-run `npm run render:maps`).
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
  // TRAFFIC LIGHT (the only multi-hue ramp; red low end is a design mandate).
  // { value0: #F45E53 vivid coral-red (worst), value100: #056E48 deep emerald (best) }
  overall: [
    { at: 0, hex: "#F45E53" },
    { at: 50, hex: "#CE4D02" },
    { at: 100, hex: "#056E48" },
  ],
  // VIOLET lens. { value0: #CE63E9 orchid (barriers), value100: #7629F1 electric indigo (accessible) }
  accessibility: [
    { at: 0, hex: "#CE63E9" },
    { at: 50, hex: "#A844EA" },
    { at: 100, hex: "#7629F1" },
  ],
  // CYAN→AZURE lens, the water register.
  // { value0: #0E9EAF bright cyan (flood-prone), value100: #0263A8 deep azure (well-drained) }
  drainage: [
    { at: 0, hex: "#0E9EAF" },
    { at: 50, hex: "#077FA8" },
    { at: 100, hex: "#0263A8" },
  ],
  // GREEN lens, and the one ramp whose luminance direction is also literal:
  // exposed asphalt is the bright end, canopy the dark end.
  // { value0: #729D0D dry lime (exposed), value100: #07703F deep canopy (shaded) }
  shade: [
    { at: 0, hex: "#729D0D" },
    { at: 50, hex: "#148918" },
    { at: 100, hex: "#07703F" },
  ],
  // MAGENTA lens. Replaced rev 2's sand→copper: a warm rust high end painted the
  // BEST bike streets in alarm-red, which reads as "bad" to anyone arriving from
  // the overall lens. Magenta carries no good/bad prior and clears violet
  // (accessibility) by ~25° of hue at these luminances.
  // { value0: #EF599A pink (no/poor infra), value100: #B20795 deep magenta (protected) }
  bike: [
    { at: 0, hex: "#EF599A" },
    { at: 50, hex: "#DF1194" },
    { at: 100, hex: "#B20795" },
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

/**
 * Score-ramp layers draw audited segments and camera-observed import/community
 * segments (canonical scores applied at payload build time). Unaudited
 * community/import features with no camera observation stay on the neutral casing.
 */
export const RAMP_LAYER_FILTER = [
  "any",
  ["!", ["in", ["get", "source"], ["literal", COMMUNITY_SOURCES]]],
  [">", ["coalesce", ["get", "cv_count"], 0], 0],
] as unknown as ExpressionSpecification;

/**
 * The community casing layer draws community/import features with no approved
 * camera observation. Observed streets route through the score ramp instead.
 */
export const COMMUNITY_LAYER_FILTER = [
  "all",
  ["in", ["get", "source"], ["literal", COMMUNITY_SOURCES]],
  ["==", ["coalesce", ["get", "cv_count"], 0], 0],
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
 * Basemap palette retuned to rev-6 GRAYSCALE ZEN so the live map reads as a plate
 * in the document (FIGURE 1): the land is the soft-white page ground, roads step
 * up to pure-white, land-use/parks are quiet neutral grays, water is a whisper of
 * gray-blue (the one non-neutral note, kept nearly desaturated so it reads zen),
 * boundaries are the hairline. All warm/creme tint retired. Applied as a post-load
 * transform over Liberty. Dark = the negative. The sealed score RAMP + flash pink
 * stay the ONLY strong chroma on the page; these grays keep enough step for the
 * ramps to stay legible. Mirror any change into scripts/render-map-images.mjs
 * BASEMAP verbatim and re-run `npm run render:maps`.
 */
export const BASEMAP = {
  light: {
    land: "#fafafa", // --paper: the page/mat ground
    landuse: "#f4f4f4",
    park: "#ededed", // quiet neutral gray (park-green desaturated to zen gray)
    water: "#e3e8ea", // quiet gray-blue (barely-there cool note)
    road: "#ffffff", // --paper-white: brightest, the plate
    roadMinor: "#fcfcfc",
    building: "#ececec",
    boundary: "#e4e4e4", // --hairline
    // Label ink (u31). The basemap keeps its full Liberty label hierarchy —
    // street names, businesses, POIs, places — recoloured to the zen register
    // rather than stripped. Primary is near-ink for places/streets; minor is a
    // step lighter so POI density never shouts over the score ramps. The halo
    // is the page ground, which is what keeps text legible where it crosses a
    // casing.
    label: "#3d3d3d",
    labelMinor: "#6f6f6f",
    labelHalo: "#fafafa",
  },
  dark: {
    land: "#0a0a0a", // --paper (the negative)
    landuse: "#101010",
    park: "#0d0d0d", // quiet dark neutral gray
    water: "#0e1214", // quiet dark gray-blue
    road: "#141414", // --paper-white (inverted): brightest
    roadMinor: "#111111",
    building: "#181818",
    boundary: "#262626", // --hairline
    // The negative: bright label ink over a near-black halo.
    label: "#d8d8d8",
    labelMinor: "#9c9c9c",
    labelHalo: "#0a0a0a",
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

/** Hillshade paint tuned to the neutral grayscale palette so it never fights the
 * score ramps in 2D: low exaggeration, neutral shadow/highlight, restrained alpha. */
export const HILLSHADE_PAINT = {
  light: {
    "hillshade-shadow-color": "rgba(0, 0, 0, 0.20)", // pure black
    "hillshade-highlight-color": "rgba(255, 255, 255, 0.34)", // paper-white
    "hillshade-accent-color": "rgba(198, 198, 198, 0.10)", // hairline-strong
    "hillshade-exaggeration": 0.3,
  },
  dark: {
    "hillshade-shadow-color": "rgba(0, 0, 0, 0.42)",
    "hillshade-highlight-color": "rgba(242, 242, 242, 0.14)", // ink
    "hillshade-accent-color": "rgba(38, 38, 38, 0.20)", // hairline
    "hillshade-exaggeration": 0.4,
  },
} as const;

/** OSM building extrusions (reuse Liberty's `building-3d` fill-extrusion; fall
 * back to any building extrusion layer present). Visible ONLY in 3D mode. */
export const BUILDINGS = {
  /** Candidate layer ids in the Liberty style, most specific first. */
  layerIdCandidates: ["building-3d", "building"] as const,
  minzoom: 14,
  color: { light: "#e8e8e8", dark: "#1c1c1c" } as const,
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
