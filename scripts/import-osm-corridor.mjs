#!/usr/bin/env node
/**
 * import-osm-corridor.mjs
 *
 * Pulls the real street network for San Antonio de Escazú, Costa Rica from the
 * OpenStreetMap Overpass API, splits each way into ~150 m block-face segments
 * with stable ids, and writes `data/segments.geojson` (geometry + metadata).
 *
 * The raw Overpass response is cached to `data/raw/overpass-san-antonio.json`;
 * re-runs use the cache unless `--refresh` is passed (be a good Overpass
 * citizen — one request per refresh).
 *
 *   node scripts/import-osm-corridor.mjs           # use cache if present
 *   node scripts/import-osm-corridor.mjs --refresh # force a fresh fetch
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw", "overpass-san-antonio.json");
const OUT_PATH = path.join(ROOT, "data", "segments.geojson");

const CANTON_ID = "esc";
const DISTRICT_ID = "esc-san-antonio";
const CORRIDOR_ID = "esc-sa-corridor";

// Bounding box for San Antonio de Escazú: [south, west, north, east].
const BBOX = [9.898, -84.162, 9.922, -84.135];

// Highway classes we turn into auditable segments.
const AUDITABLE = new Set([
  "residential",
  "tertiary",
  "secondary",
  "unclassified",
  "footway",
]);

// Broader "street network" set used as the coverage denominator.
const STREET_NETWORK = new Set([
  "residential",
  "tertiary",
  "secondary",
  "primary",
  "unclassified",
  "living_street",
  "pedestrian",
  "service",
  "footway",
  "path",
  "track",
]);

const TARGET_SEGMENT_M = 150; // aim for ~100-200 m block faces
const MIN_SEGMENT_M = 40; // shorter tails get merged back

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

function buildQuery() {
  const [s, w, n, e] = BBOX;
  return `[out:json][timeout:90];
(
  way["highway"](${s},${w},${n},${e});
);
out geom;`;
}

/** Haversine distance in meters between two [lon, lat] points. */
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function lineLength(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Split a polyline (array of [lon,lat]) into runs of ~TARGET_SEGMENT_M. Cuts at
 * existing vertices; a trailing run shorter than MIN_SEGMENT_M is merged back
 * into the previous run.
 */
function splitPolyline(coords) {
  if (coords.length < 2) return [];
  const runs = [];
  let current = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const d = haversine(coords[i - 1], coords[i]);
    current.push(coords[i]);
    acc += d;
    if (acc >= TARGET_SEGMENT_M && i < coords.length - 1) {
      runs.push(current);
      current = [coords[i]]; // next run starts where this one ended
      acc = 0;
    }
  }
  if (current.length >= 2) {
    if (lineLength(current) < MIN_SEGMENT_M && runs.length > 0) {
      // merge short tail into previous run (drop the duplicated shared vertex)
      const prev = runs[runs.length - 1];
      runs[runs.length - 1] = prev.concat(current.slice(1));
    } else {
      runs.push(current);
    }
  }
  return runs;
}

function roundCoord([lon, lat]) {
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

function segmentName(tags, highway, index) {
  const named = tags?.name || tags?.["name:es"] || tags?.["name:en"];
  if (named) return named;
  if (highway === "footway" || highway === "path") {
    return `Sendero sin nombre ${index}`;
  }
  return `Calle sin nombre ${index}`;
}

async function loadRaw({ refresh }) {
  if (!refresh) {
    try {
      const cached = await fs.readFile(RAW_PATH, "utf8");
      console.log(`[import] using cached Overpass response: ${RAW_PATH}`);
      return JSON.parse(cached);
    } catch {
      // fall through to fetch
    }
  }

  const query = buildQuery();
  console.log(`[import] querying Overpass (${OVERPASS_ENDPOINT})...`);
  const res = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "StreetLens/0.1 (open street audit, Escazu CR; +https://github.com/gianluca-fonseca)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  await fs.mkdir(path.dirname(RAW_PATH), { recursive: true });
  await fs.writeFile(RAW_PATH, JSON.stringify(json, null, 2));
  console.log(`[import] cached raw response -> ${RAW_PATH}`);
  return json;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const raw = await loadRaw({ refresh });

  const ways = (raw.elements || [])
    .filter(
      (el) =>
        el.type === "way" &&
        Array.isArray(el.geometry) &&
        el.geometry.length >= 2 &&
        el.tags?.highway,
    )
    // deterministic ordering => stable ids across runs
    .sort((a, b) => a.id - b.id);

  let networkMeters = 0;
  const features = [];
  let seq = 0;

  for (const way of ways) {
    const highway = way.tags.highway;
    const coords = way.geometry.map((g) => roundCoord([g.lon, g.lat]));

    if (STREET_NETWORK.has(highway)) {
      networkMeters += lineLength(coords);
    }
    if (!AUDITABLE.has(highway)) continue;

    const runs = splitPolyline(coords);
    for (const run of runs) {
      const length_m = lineLength(run);
      if (length_m < MIN_SEGMENT_M) continue;
      seq += 1;
      const id = `esc-sa-${String(seq).padStart(4, "0")}`;
      features.push({
        type: "Feature",
        properties: {
          id,
          name: segmentName(way.tags, highway, seq),
          canton_id: CANTON_ID,
          district_id: DISTRICT_ID,
          corridor_id: CORRIDOR_ID,
          highway,
          length_m: Number(length_m.toFixed(1)),
          osm_way_id: way.id,
        },
        geometry: { type: "LineString", coordinates: run },
      });
    }
  }

  const auditedMeters = features.reduce(
    (sum, f) => sum + f.properties.length_m,
    0,
  );

  const collection = {
    type: "FeatureCollection",
    metadata: {
      source: "OpenStreetMap via Overpass API",
      license: "ODbL 1.0",
      district: "San Antonio de Escazú",
      canton_id: CANTON_ID,
      district_id: DISTRICT_ID,
      corridor_id: CORRIDOR_ID,
      bbox: BBOX,
      generated_at: new Date().toISOString(),
      segment_count: features.length,
      audited_km: Number((auditedMeters / 1000).toFixed(2)),
      network_km: Number((networkMeters / 1000).toFixed(2)),
      coverage_pct:
        networkMeters > 0
          ? Number(((auditedMeters / networkMeters) * 100).toFixed(1))
          : 100,
    },
    features,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(collection, null, 2));

  console.log(
    `[import] wrote ${features.length} segments (${collection.metadata.audited_km} km audited / ${collection.metadata.network_km} km network, ${collection.metadata.coverage_pct}% coverage) -> ${OUT_PATH}`,
  );

  if (features.length < 40) {
    console.error(
      `[import] WARNING: only ${features.length} segments (<40). Widen the bbox or check the Overpass response.`,
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
