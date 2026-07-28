// scripts/render-map-images.mjs
//
// Deterministic, zero-network STATIC SVG map renderer for the StreetLens landing
// page. Reads the REAL segment geometry from data/demo-segments.geojson and paints
// it with the REAL color ramps + width channel + basemap palette from
// components/mapConfig.ts. Output SVGs are used as full-bleed section background
// art (glass panels layer on top). Real geometry, real ramps only — honest data-art.
//
// Pure Node ESM, Node 20+, ZERO npm dependencies (only fs/path/url built-ins).
// Run: `node scripts/render-map-images.mjs`  (or `npm run render:maps`).
//
// ---------------------------------------------------------------------------
// The constants + helpers below MIRROR components/mapConfig.ts and MUST be kept
// in sync with it. If the ramps, width channel, or BASEMAP palette change there,
// update them here too. (This script cannot import the .ts module without a build
// step, so the values are replicated verbatim as plain JS.)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEOJSON_PATH = join(ROOT, "data", "demo-segments.geojson");
const OUT_DIR = join(ROOT, "public", "render");

// --- RAMP: mirrors mapConfig.ts RAMP (rev 8: 5 stops per lens PER THEME) -----
// Regenerate with `node scripts/design-ramps.mjs --ts`; never hand-edit.
const RAMP = {
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

// --- Width channel: mirrors mapConfig.ts (HIGHER score = thicker line) --------
const WIDTH_AT_0 = 1.6;
const WIDTH_AT_100 = 7;

// --- BASEMAP palette: mirrors mapConfig.ts BASEMAP ---------------------------
const BASEMAP = {
  light: {
    land: "#fafafa",
    landuse: "#f4f4f4",
    park: "#ededed",
    water: "#e3e8ea",
    road: "#ffffff",
    roadMinor: "#fcfcfc",
    building: "#ececec",
    boundary: "#e4e4e4",
    label: "#3d3d3d",
    labelMinor: "#6f6f6f",
    labelHalo: "#fafafa",
  },
  dark: {
    land: "#0a0a0a",
    landuse: "#101010",
    park: "#0d0d0d",
    water: "#0e1214",
    road: "#141414",
    roadMinor: "#111111",
    building: "#181818",
    boundary: "#262626",
    label: "#d8d8d8",
    labelMinor: "#9c9c9c",
    labelHalo: "#0a0a0a",
  },
};

// --- ramp / width helpers (mirror mapConfig.ts sampleRamp + widthForValue) ----
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

// CIELAB, D50, mirroring mapConfig.ts (which in turn mirrors MapLibre's own
// `interpolate-lab`). The rendered SVGs have to be the same picture the live
// map draws, so they interpolate in the same space.
const LAB_XN = 0.96422;
const LAB_ZN = 0.82521;
const LAB_T0 = 4 / 29;
const LAB_T1 = 6 / 29;
const LAB_T2 = 3 * LAB_T1 * LAB_T1;
const LAB_T3 = LAB_T1 * LAB_T1 * LAB_T1;
const labF = (t) => (t > LAB_T3 ? Math.cbrt(t) : t / LAB_T2 + LAB_T0);
const labFInv = (t) => (t > LAB_T1 ? t * t * t : LAB_T2 * (t - LAB_T0));

function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const y = labF(0.2225045 * r + 0.7168786 * g + 0.0606169 * b);
  const x = labF((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / LAB_XN);
  const z = labF((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / LAB_ZN);
  return [Math.max(0, 116 * y - 16), 500 * (x - y), 200 * (y - z)];
}

function labToHex([l, a, bb]) {
  let y = (l + 16) / 116;
  const x = LAB_XN * labFInv(y + a / 500);
  const z = LAB_ZN * labFInv(y - bb / 200);
  y = labFInv(y);
  const toSrgb = (c) => {
    const s = c <= 0.00304 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, s)) * 255;
  };
  return rgbToHex([
    toSrgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
    toSrgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
    toSrgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
  ]);
}

/** CIELAB lerp between the 5 ramp stops of the requested theme. */
function sampleRamp(layer, value, theme) {
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
/** Representative line width for a 0–100 value (higher score = thicker). */
function widthForValue(value) {
  const v = Math.max(0, Math.min(100, value));
  return WIDTH_AT_0 + (WIDTH_AT_100 - WIDTH_AT_0) * (v / 100);
}

// --- geometry / projection ---------------------------------------------------
const DEG2RAD = Math.PI / 180;

/** Round to 1 decimal, dropping a trailing ".0" for compact SVG. */
function r1(n) {
  const s = (Math.round(n * 10) / 10).toString();
  return s;
}

/**
 * Build a lon/lat → SVG x/y projector for a given canvas + bbox.
 * Web-Mercator-flavored with a latitude cos-correction so the aspect ratio is
 * geographically correct (for a small canton this is essentially linear).
 * Fits the bbox into the padded inner box preserving aspect, then centers it.
 */
function makeProjector(bbox, width, height, pad) {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos(midLat * DEG2RAD);
  // projected extents (x scaled by cos-correction; y flipped so north is up)
  const geoW = (maxLon - minLon) * cos || 1e-9;
  const geoH = (maxLat - minLat) || 1e-9;
  const iw = width - 2 * pad;
  const ih = height - 2 * pad;
  const scale = Math.min(iw / geoW, ih / geoH);
  const offX = pad + (iw - geoW * scale) / 2;
  const offY = pad + (ih - geoH * scale) / 2;
  return (lon, lat) => {
    const px = (lon - minLon) * cos;
    const py = maxLat - lat; // flip: north at top
    return [offX + px * scale, offY + py * scale];
  };
}

function computeBbox(features) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const f of features) {
    for (const [lon, lat] of f.geometry.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Build the "d" attribute for a LineString feature under a projector. */
function pathData(feature, project) {
  const pts = feature.geometry.coordinates.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return `${r1(x)} ${r1(y)}`;
  });
  return "M" + pts.join("L");
}

function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// --- SVG assembly ------------------------------------------------------------
/**
 * Render one SVG.
 *  opts:
 *   width, height, pad
 *   theme: "light" | "dark"
 *   lens: ramp key
 *   allFeatures: full network (drawn as faint base layer)
 *   activeFeatures: features colored by the active lens (defaults to all)
 *   bbox: projection bbox (defaults to bbox of activeFeatures)
 */
function renderSvg(opts) {
  const {
    width,
    height,
    pad = Math.round(Math.min(width, height) * 0.05),
    theme,
    lens,
    allFeatures,
    activeFeatures = allFeatures,
    bbox,
  } = opts;

  const pal = BASEMAP[theme];
  const bb = bbox || computeBbox(activeFeatures);
  const project = makeProjector(bb, width, height, pad);

  const field = pal.land;
  // warm-gray base-network color from the basemap palette (boundary reads as a
  // subtle warm gray over the land field on both themes).
  const baseStroke = pal.boundary;
  const baseOpacity = theme === "dark" ? 0.5 : 0.55;
  const activeOpacity = 0.92;

  // (2) faint full street network — ALL segments, thin neutral warm-gray.
  const basePaths = allFeatures
    .map((f) => `<path d="${pathData(f, project)}"/>`)
    .join("");

  // (3) active lens — each segment colored + width from the ramp/width channel.
  const activePaths = activeFeatures
    .map((f) => {
      const score = f.properties[`score_${lens}`];
      const color = sampleRamp(lens, score, theme);
      const w = r1(widthForValue(score));
      return `<path d="${pathData(f, project)}" stroke="${color}" stroke-width="${w}"/>`;
    })
    .join("");

  // (1) solid field background + layers. round caps/joins for organic street feel.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="${width}" height="${height}" fill="${field}"/>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="${baseStroke}" stroke-width="1.1" opacity="${baseOpacity}">${basePaths}</g>` +
    `<g opacity="${activeOpacity}">${activePaths}</g>` +
    `</g></svg>`
  );
}

// --- main --------------------------------------------------------------------
function main() {
  const geo = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  const features = geo.features.filter(
    (f) => f.geometry && f.geometry.type === "LineString",
  );
  mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  function emit(name, svg) {
    const p = join(OUT_DIR, name);
    writeFileSync(p, svg);
    const bytes = statSync(p).size;
    written.push({ name, bytes });
    const kb = (bytes / 1024).toFixed(1);
    console.log(`  wrote ${name}  (${bytes} bytes, ${kb} KB)`);
  }

  const LENSES = ["overall", "accessibility", "drainage", "shade", "bike"];
  const globalBbox = computeBbox(features);

  console.log(`Rendering ${features.length} segments →  ${OUT_DIR}`);

  // Per-lens, LIGHT field, full extent, ~4:3. "overall" is retired here (rev-5):
  // the overall lens ships as atlas-wide/atlas-dark, so lens-overall.svg is
  // orphaned art and no longer emitted.
  for (const lens of LENSES.filter((l) => l !== "overall")) {
    emit(
      `lens-${lens}.svg`,
      renderSvg({
        width: 1200,
        height: 900,
        theme: "light",
        lens,
        allFeatures: features,
        bbox: globalBbox,
      }),
    );
  }

  // atlas-wide: LIGHT, overall, cinematic wide.
  emit(
    "atlas-wide.svg",
    renderSvg({
      width: 2000,
      height: 1000,
      theme: "light",
      lens: "overall",
      allFeatures: features,
      bbox: globalBbox,
    }),
  );

  // atlas-dark: same but DARK field.
  emit(
    "atlas-dark.svg",
    renderSvg({
      width: 2000,
      height: 1000,
      theme: "dark",
      lens: "overall",
      allFeatures: features,
      bbox: globalBbox,
    }),
  );

  // Per-district, LIGHT, overall lens, cropped/zoomed to the district's bbox.
  const districts = [...new Set(features.map((f) => f.properties.district))]
    .filter(Boolean)
    .sort();
  const districtSlugs = [];
  for (const district of districts) {
    const slug = slugify(district);
    districtSlugs.push({ district, slug });
    const districtFeatures = features.filter(
      (f) => f.properties.district === district,
    );
    // Crop projection to this district's segments; the district's own segments
    // are the colored focus, drawn over the full faint network for context.
    emit(
      `district-${slug}.svg`,
      renderSvg({
        width: 1200,
        height: 900,
        theme: "light",
        lens: "overall",
        allFeatures: features,
        activeFeatures: districtFeatures,
        bbox: computeBbox(districtFeatures),
      }),
    );
  }

  console.log(`\nDone. ${written.length} SVGs written.`);
  console.log(
    `Districts: ${districtSlugs.map((d) => `${d.district} → ${d.slug}`).join(", ")}`,
  );
}

main();
