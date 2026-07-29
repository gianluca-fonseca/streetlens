import type { ExpressionSpecification } from "maplibre-gl";
// Type-only import: erased at build time, so lib/segments' fs usage never
// reaches the client bundle.
import type { ScoreLayer } from "@/lib/segments";

/*
 * Score-layer visual encoding — rev 8. Semantics: HIGH = GOOD for every layer.
 *
 * ── THE DIRECTION RULE ─────────────────────────────────────────────────────
 * MORE PRESENCE MEANS A BETTER SCORE, on every channel, everywhere:
 *
 *   colour  a better street carries more contrast against the page it sits on
 *           (darker on the light basemap, brighter on the dark one)
 *   width   a better street is THICKER          (widthForValue, below)
 *   height  a better street is TALLER           (components/scoreRelief.ts)
 *
 * Rev 7 had width running the other way ("lower score = thicker, to surface the
 * problems") while the landing relief made the best streets the tallest. Both
 * are defensible on their own; together they taught the viewer two opposite
 * rules for one quantity inside one product, which is the thing a reader cannot
 * un-learn between two screens. Score-as-magnitude wins because it is the
 * convention every chart already uses (a bigger mark means a bigger number), and
 * reading the map WITHOUT the legend is the whole requirement. The floor below
 * keeps the losing side of that trade honest: every stop still clears 3:1
 * against the basemap, so the worst street is quieter but never invisible.
 *
 * ── WHY REV 8 REPLACED REV 7 ───────────────────────────────────────────────
 * Rev 7 asked ONE table to be legible on both basemaps at once. BASEMAP is
 * near-white in light (land #fafafa, roads #ffffff) and near-black in dark (land
 * #0a0a0a, roads #141414), so clearing 3:1 on both pinned every stop into a
 * relative-luminance band of 0.118–0.278. Inside a band that narrow there is
 * simply no room left to separate scores: measured on the shipped rev-7 table,
 * adjacent quartiles sat 3.8–6.1 ΔE apart (OKLab ×100) and 3.3–5.6 apart under
 * deuteranopia — under the ~8 ΔE at which two colours reliably read as two
 * colours. That is the "thickness is not a good proxy / hard to see what is
 * excellent vs poor" report, and no amount of re-picking hexes fixes it, because
 * the band is the constraint, not the choices inside it.
 *
 * So rev 8 splits the table per theme. A line is only ever painted on ONE
 * basemap at a time, so it only has to clear that one. Each half then gets the
 * full lightness runway its own basemap allows, and the direction rule falls out
 * of the geometry: on white, more contrast means darker; on black, brighter.
 * The luminance direction flipping between themes is the standard sequential-ramp
 * behaviour (a ramp re-anchors in dark mode), not an inconsistency: within the
 * theme you are actually looking at, more ink always means a better street.
 *
 * Every stop is SOLVED, not picked — scripts/design-ramps.mjs is the derivation
 * and re-emits this table. Per lens per theme it walks OKLCH lightness from the
 * quiet end (the extreme its basemap still allows at 3.05:1) to the loud end in
 * five even steps, taking 95% of the in-gamut chroma at each, on that lens's
 * hue journey. Results (worst case across the ten ramps):
 *
 *   adjacent quartiles   ≥ 8.5 ΔE normal, ≥ 7.8 deuteranopia
 *   25th vs 75th pct     ≥ 15.3 ΔE normal, ≥ 16.0 deuteranopia, ≥ 9.3 protanopia
 *   end to end           ≥ 34.7 ΔE normal
 *   every stop           ≥ 3.05:1 on its theme's land AND road
 *
 * Stops are declared AT the quartiles rather than at 0/50/100 so the numbers
 * above describe the ramp's own stops. The map interpolates with
 * `interpolate-lab` and sampleRamp() mirrors MapLibre's CIELAB maths exactly, so
 * the legend swatch and the line it explains are the same colour.
 *
 * ── WHAT IS PRESERVED ──────────────────────────────────────────────────────
 * Each lens keeps its hue family, measured off the rev-7 stops rather than
 * re-invented: overall is the only multi-hue ramp (the traffic light, red low
 * end, a design mandate); accessibility orchid→indigo; drainage cyan→azure, the
 * water register; shade lime→canopy; bike pink→magenta. Bike stays magenta for
 * the reason it left copper: a warm rust high end painted the BEST bike streets
 * in alarm-red, contradicting the overall lens the reader just came from.
 * Magenta also clears violet by ~25° at these lightnesses.
 *
 * CVD: simulated protan and deutan luminance is strictly monotonic across all
 * ten ramps, so worst→best survives with colour removed entirely. The known
 * residue is the `overall` traffic light in the light theme, where protanopia
 * compresses the 50→75 step to 2.9 ΔE; width (and height in the hero) is the
 * carrier there. See <EVIDENCE>/ramp-discriminability.md.
 *
 * scripts/test-ramp-legibility.mjs re-derives every rule above and fails if a
 * future edit breaks one; scripts/test-score-color.mjs freezes the table
 * stop-for-stop; scripts/render-map-images.mjs mirrors it verbatim — change one
 * and you must change all three (then re-run `npm run render:maps`).
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

/** The two basemaps a score line is ever painted on; each owns half the table. */
export type RampTheme = "light" | "dark";

type LensRamp = Record<RampTheme, RampStop[]>;

/*
 * The solved table (scripts/design-ramps.mjs --ts emits exactly this). Read a
 * row left to right as worst → best. In `light` the journey darkens; in `dark`
 * it brightens. Both are the same sentence: the better the street, the more it
 * stands off the page.
 */
export const RAMP: Record<ScoreLayer, LensRamp> = {
  // TRAFFIC LIGHT (the only multi-hue ramp; red low end is a design mandate).
  // Reaches green by the 75th percentile rather than drifting through yellow: on
  // a lightness-ordered ramp a yellow stop is an olive stop, and "nearly
  // excellent" has to look like the good end.
  // light: coral-red → rust → dark emerald.  dark: brick red → amber → mint.
  overall: {
    light: [
      { at: 0, hex: "#FB574D" },
      { at: 25, hex: "#CF4713" },
      { at: 50, hex: "#95470D" },
      { at: 75, hex: "#09542F" },
      { at: 100, hex: "#043727" },
    ],
    dark: [
      { at: 0, hex: "#C4171A" },
      { at: 25, hex: "#DA4B15" },
      { at: 50, hex: "#EC741B" },
      { at: 75, hex: "#28D580" },
      { at: 100, hex: "#30F1B6" },
    ],
  },
  // VIOLET lens: orchid (barriers) → electric indigo (accessible).
  accessibility: {
    light: [
      { at: 0, hex: "#D953FA" },
      { at: 25, hex: "#B31EF1" },
      { at: 50, hex: "#8416CB" },
      { at: 75, hex: "#590EA2" },
      { at: 100, hex: "#350775" },
    ],
    dark: [
      { at: 0, hex: "#A417C2" },
      { at: 25, hex: "#BB29F9" },
      { at: 50, hex: "#B976FA" },
      { at: 75, hex: "#C0A3FB" },
      { at: 100, hex: "#CFC7FD" },
    ],
  },
  // CYAN→AZURE lens, the water register: flood-prone → well-drained.
  drainage: {
    light: [
      { at: 0, hex: "#1D9EAF" },
      { at: 25, hex: "#168199" },
      { at: 50, hex: "#0F6483" },
      { at: 75, hex: "#08496B" },
      { at: 100, hex: "#032F53" },
    ],
    dark: [
      { at: 0, hex: "#106D78" },
      { at: 25, hex: "#1888A2" },
      { at: 50, hex: "#1FA4D3" },
      { at: 75, hex: "#58BDFB" },
      { at: 100, hex: "#ACD4FD" },
    ],
  },
  // GREEN lens: dry lime (exposed asphalt) → deep canopy (shaded).
  shade: {
    light: [
      { at: 0, hex: "#739D19" },
      { at: 25, hex: "#4D8513" },
      { at: 50, hex: "#246D0D" },
      { at: 75, hex: "#09531B" },
      { at: 100, hex: "#04381B" },
    ],
    dark: [
      { at: 0, hex: "#4E6D0E" },
      { at: 25, hex: "#528E15" },
      { at: 50, hex: "#40B21C" },
      { at: 75, hex: "#28D553" },
      { at: 100, hex: "#30F58A" },
    ],
  },
  // MAGENTA lens: pink (no/poor infra) → deep magenta (protected).
  bike: {
    light: [
      { at: 0, hex: "#FB4B9C" },
      { at: 25, hex: "#D81B8A" },
      { at: 50, hex: "#A81375" },
      { at: 75, hex: "#7B0B5D" },
      { at: 100, hex: "#510543" },
    ],
    dark: [
      { at: 0, hex: "#BD166D" },
      { at: 25, hex: "#E21D91" },
      { at: 50, hex: "#FB49B6" },
      { at: 75, hex: "#FC86D2" },
      { at: 100, hex: "#FDB5E8" },
    ],
  },
};

/*
 * Width channel: HIGHER score = thicker line, agreeing with colour and with the
 * hero's height. Rev 7 ran 6px→2.5px the other way, a 2.4x spread that read as
 * noise on a network whose streets already vary in apparent importance. 1.6→7px
 * is 4.4x, and the extra 1.2px of absolute range is what makes the channel
 * survive being glanced at rather than studied. The 1.6px floor is deliberate:
 * a poor street must stay a drawn line, because it is still the answer to
 * "which street needs work".
 */
const WIDTH_AT_0 = 1.6;
const WIDTH_AT_100 = 7;

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
      .map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/*
 * CIELAB, mirroring MapLibre's own Color.lab getter EXACTLY — same D50 white
 * point (0.96422 / 1 / 0.82521) and the same Bradford-adapted sRGB matrices it
 * uses for `interpolate-lab`. Not a general colour library and not a place to
 * be clever: its whole job is that sampleRamp() lands on the pixel the map
 * paints, so the legend swatch and the line it explains cannot drift apart.
 */
const LAB_XN = 0.96422;
const LAB_ZN = 0.82521;
const LAB_T0 = 4 / 29;
const LAB_T1 = 6 / 29;
const LAB_T2 = 3 * LAB_T1 * LAB_T1;
const LAB_T3 = LAB_T1 * LAB_T1 * LAB_T1;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > LAB_T3 ? Math.cbrt(t) : t / LAB_T2 + LAB_T0;
}

function labFInv(t: number): number {
  return t > LAB_T1 ? t * t * t : LAB_T2 * (t - LAB_T0);
}

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => srgbToLinear(c / 255));
  const y = labF(0.2225045 * r + 0.7168786 * g + 0.0606169 * b);
  const x = labF((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / LAB_XN);
  const z = labF((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / LAB_ZN);
  return [Math.max(0, 116 * y - 16), 500 * (x - y), 200 * (y - z)];
}

function labToHex([l, a, bb]: [number, number, number]): string {
  let y = (l + 16) / 116;
  const x = LAB_XN * labFInv(y + a / 500);
  const z = LAB_ZN * labFInv(y - bb / 200);
  y = labFInv(y);
  const toSrgb = (c: number) => {
    const s = c <= 0.00304 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, s)) * 255;
  };
  return rgbToHex([
    toSrgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
    toSrgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
    toSrgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
  ]);
}

/**
 * Sample a layer ramp at an arbitrary 0–100 value, for the theme the reader is
 * actually looking at. Used for legend swatches, the panel ink derivation, and
 * the OG cards. Interpolates in CIELAB, not in raw sRGB: an sRGB lerp between
 * two stops of different lightness dips through a desaturated middle, which is
 * how rev 7's mid values ended up reading as mush.
 */
export function sampleRamp(
  layer: ScoreLayer,
  value: number,
  theme: RampTheme = "light",
): string {
  const stops = RAMP[layer][theme];
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
  const a = hexToLab(lo.hex);
  const b = hexToLab(hi.hex);
  return labToHex([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]);
}

/**
 * Representative line width for a 0–100 value (legend width cue + parity with
 * the map). Grows with the score, like every other channel.
 */
export function widthForValue(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return WIDTH_AT_0 + (WIDTH_AT_100 - WIDTH_AT_0) * (v / 100);
}

/**
 * MapLibre line-color expression for the active layer on the active basemap.
 *
 * `interpolate-lab` rather than `interpolate`: MapLibre's plain interpolate
 * lerps colour channels in gamma-encoded sRGB, which is not a perceptual space.
 * The lab variant is MapLibre's own CIELAB path and is what sampleRamp mirrors.
 */
export function lineColorExpression(
  layer: ScoreLayer,
  theme: RampTheme = "light",
): ExpressionSpecification {
  const stops = RAMP[layer][theme];
  const prop = scoreProp(layer);
  return [
    "interpolate-lab",
    ["linear"],
    ["get", prop],
    ...stops.flatMap((s) => [s.at, s.hex] as [number, string]),
  ] as unknown as ExpressionSpecification;
}

/** MapLibre line-width expression: thicker with a HIGHER score (see the
 *  direction rule at the top), and thicker again while hovered. */
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
