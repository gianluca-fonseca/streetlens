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

// --- RAMP: mirrors mapConfig.ts RAMP (3 stops per lens, high = good) ---------
const RAMP = {
  overall: [
    { at: 0, hex: "#C0472B" },
    { at: 50, hex: "#E8B84B" },
    { at: 100, hex: "#0E7C66" },
  ],
  accessibility: [
    { at: 0, hex: "#FFE945" },
    { at: 50, hex: "#7C7B78" },
    { at: 100, hex: "#00204D" },
  ],
  drainage: [
    { at: 0, hex: "#C7C13B" },
    { at: 50, hex: "#4CA377" },
    { at: 100, hex: "#21808C" },
  ],
  shade: [
    { at: 0, hex: "#DDE3CE" },
    { at: 50, hex: "#6E9463" },
    { at: 100, hex: "#14532D" },
  ],
  bike: [
    { at: 0, hex: "#E8D9C4" },
    { at: 50, hex: "#C88C5E" },
    { at: 100, hex: "#8A4B2D" },
  ],
};

// --- Width channel: mirrors mapConfig.ts (lower score = thicker line) ---------
const WIDTH_AT_0 = 6;
const WIDTH_AT_100 = 2.5;

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
    rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")
  );
}
/** Linear sRGB lerp between the 3 ramp stops. */
function sampleRamp(layer, value) {
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
/** Representative line width for a 0–100 value (lower score = thicker). */
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
      const color = sampleRamp(lens, score);
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
