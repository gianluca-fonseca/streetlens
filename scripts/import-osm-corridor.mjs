#!/usr/bin/env node
/**
 * import-osm-corridor.mjs
 *
 * Pulls the real street network for the whole canton of Escazú, Costa Rica from
 * the OpenStreetMap Overpass API, splits each way into ~150 m block-face segments
 * with stable ids, and writes `data/segments.geojson` (geometry + metadata).
 *
 * The canton has three districts, imported in a fixed order so the pilot stays
 * byte-identical:
 *   1. San Antonio de Escazú — the audited pilot corridor. Fetched by the ORIGINAL
 *      bounding box and cached to `data/raw/overpass-san-antonio.json`; its
 *      `esc-sa-NNNN` features are frozen (see scripts/test-canton-identity.mjs).
 *   2. Escazú centro (`esc-ce-NNNN`, district `esc-escazu`).
 *   3. San Rafael de Escazú (`esc-sr-NNNN`, district `esc-san-rafael`).
 *
 * The two new districts are fetched by their OSM administrative boundary (Overpass
 * `area`) so district membership is exact rather than a rough bbox. A way already
 * emitted by an earlier district is skipped, so a way straddling a district line
 * is never split into two competing segments (San Antonio, imported first, keeps
 * every way in its bbox — that is what freezes the pilot).
 *
 * Each district's raw Overpass response is cached under `data/raw/`; re-runs use
 * the cache and are fully offline unless `--refresh` is passed (be a good Overpass
 * citizen — one request per district per refresh).
 *
 *   node scripts/import-osm-corridor.mjs           # use caches if present
 *   node scripts/import-osm-corridor.mjs --refresh # force a fresh fetch per district
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_PATH = path.join(ROOT, "data", "segments.geojson");

const CANTON_ID = "esc";
const CANTON_NAME = "Escazú";

// Pilot bounding box for San Antonio de Escazú: [south, west, north, east].
// FROZEN — changing this would shift every esc-sa-* id.
const PILOT_BBOX = [9.898, -84.162, 9.922, -84.135];

/**
 * District import order. San Antonio MUST be first and MUST keep its original
 * bbox query + cache file so the pilot output is byte-identical to the v1 import.
 * The two new districts fetch by OSM admin-boundary relation (Overpass area id =
 * 3600000000 + relation id).
 */
const DISTRICTS = [
  {
    key: "san-antonio",
    idPrefix: "esc-sa",
    districtId: "esc-san-antonio",
    corridorId: "esc-sa-corridor",
    name: "San Antonio de Escazú",
    cache: "overpass-san-antonio.json",
    query: "bbox",
    bbox: PILOT_BBOX,
  },
  {
    key: "escazu-centro",
    idPrefix: "esc-ce",
    districtId: "esc-escazu",
    corridorId: null,
    name: "Escazú centro",
    cache: "overpass-escazu-centro.json",
    query: "area",
    relation: 4071271,
  },
  {
    key: "san-rafael",
    idPrefix: "esc-sr",
    districtId: "esc-san-rafael",
    corridorId: null,
    name: "San Rafael de Escazú",
    cache: "overpass-san-rafael.json",
    query: "area",
    relation: 4070148,
  },
];

// Highway classes we turn into auditable segments. `cycleway` ways are dedicated
// bike infrastructure and auditable in their own right (they carry the strongest
// bike_infra hint).
const AUDITABLE = new Set([
  "residential",
  "tertiary",
  "secondary",
  "unclassified",
  "footway",
  "cycleway",
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

// Overpass mirrors, tried in order with backoff. The public instances routinely
// return a transient 504 ("server is probably too busy"); a couple of retries
// across mirrors makes a --refresh reliable without hammering any one host.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST a query to Overpass, retrying across mirrors on a transient failure. */
async function overpassFetch(query, label) {
  const attempts = 5;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    const endpoint = OVERPASS_ENDPOINTS[i % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "StreetLens/0.1 (open street audit, Escazu CR; +https://github.com/gianluca-fonseca)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return res.json();
      const body = (await res.text()).slice(0, 160);
      lastErr = new Error(`Overpass HTTP ${res.status}: ${body}`);
    } catch (err) {
      lastErr = err;
    }
    const waitMs = 2000 * (i + 1);
    console.log(
      `[import] ${label}: ${endpoint} failed (attempt ${i + 1}/${attempts}); retrying in ${waitMs / 1000}s...`,
    );
    await sleep(waitMs);
  }
  throw lastErr;
}

function buildQuery(district) {
  if (district.query === "bbox") {
    const [s, w, n, e] = district.bbox;
    return `[out:json][timeout:90];
(
  way["highway"](${s},${w},${n},${e});
);
out geom;`;
  }
  // Admin-boundary area query. Overpass area id = 3600000000 + relation id.
  const areaId = 3600000000 + district.relation;
  return `[out:json][timeout:90];
area(${areaId})->.d;
(
  way["highway"](area.d);
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

/**
 * Distil the per-way OSM bike tags into one hint the demo scorer can read:
 *   cycleway | track | lane | shared | none  (strongest → weakest).
 * A dedicated `highway=cycleway` way is the strongest signal. Otherwise the
 * `cycleway[:left|:right|:both]` values classify the on-street infrastructure;
 * `bicycle=yes` alone is legal access, NOT infrastructure, so it stays `none`.
 */
function bikeInfraHint(tags, highway) {
  if (highway === "cycleway") return "cycleway";
  const vals = [
    tags?.cycleway,
    tags?.["cycleway:both"],
    tags?.["cycleway:left"],
    tags?.["cycleway:right"],
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  const has = (...needles) =>
    vals.some((v) => needles.some((n) => v.includes(n)));

  if (has("track", "sidepath", "separate")) return "track";
  if (has("lane")) return "lane";
  if (has("shared", "share_busway")) return "shared";
  return "none";
}

function segmentName(tags, highway, index) {
  const named = tags?.name || tags?.["name:es"] || tags?.["name:en"];
  if (named) return named;
  if (highway === "footway" || highway === "path") {
    return `Sendero sin nombre ${index}`;
  }
  return `Calle sin nombre ${index}`;
}

async function loadRaw(district, { refresh }) {
  const rawPath = path.join(RAW_DIR, district.cache);
  if (!refresh) {
    try {
      const cached = await fs.readFile(rawPath, "utf8");
      console.log(`[import] ${district.key}: using cached Overpass response`);
      return JSON.parse(cached);
    } catch {
      // fall through to fetch
    }
  }

  const query = buildQuery(district);
  console.log(`[import] ${district.key}: querying Overpass...`);
  const json = await overpassFetch(query, district.key);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(rawPath, JSON.stringify(json, null, 2));
  console.log(`[import] ${district.key}: cached raw response -> ${rawPath}`);
  return json;
}

/**
 * Turn one district's raw Overpass response into auditable segment features.
 * `claimed` is the set of osm_way_ids already emitted by an earlier district;
 * ways in it are skipped so a boundary-straddling way is never double-counted.
 * Mutates `claimed` with every way this district emits.
 */
function districtFeatures(district, raw, claimed) {
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

    if (!AUDITABLE.has(highway)) {
      // Non-auditable classes still count toward the coverage denominator, but
      // only the first district to see the way claims its length.
      if (STREET_NETWORK.has(highway) && !claimed.has(way.id)) {
        networkMeters += lineLength(coords);
      }
      continue;
    }
    // An auditable way already emitted by an earlier district belongs to it.
    if (claimed.has(way.id)) continue;
    claimed.add(way.id);

    if (STREET_NETWORK.has(highway)) {
      networkMeters += lineLength(coords);
    }

    const bikeInfra = bikeInfraHint(way.tags, highway);
    const runs = splitPolyline(coords);
    for (const run of runs) {
      const length_m = lineLength(run);
      if (length_m < MIN_SEGMENT_M) continue;
      seq += 1;
      const id = `${district.idPrefix}-${String(seq).padStart(4, "0")}`;
      features.push({
        type: "Feature",
        properties: {
          id,
          name: segmentName(way.tags, highway, seq),
          canton_id: CANTON_ID,
          district_id: district.districtId,
          corridor_id: district.corridorId,
          highway,
          bike_infra: bikeInfra,
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

  return {
    features,
    stats: {
      district_id: district.districtId,
      name: district.name,
      corridor_id: district.corridorId,
      query: district.query,
      relation: district.relation ?? null,
      bbox: district.bbox ?? null,
      segment_count: features.length,
      audited_km: Number((auditedMeters / 1000).toFixed(2)),
      network_km: Number((networkMeters / 1000).toFixed(2)),
      coverage_pct:
        networkMeters > 0
          ? Number(((auditedMeters / networkMeters) * 100).toFixed(1))
          : 100,
    },
  };
}

async function main() {
  const refresh = process.argv.includes("--refresh");

  const claimed = new Set();
  const allFeatures = [];
  const districtStats = {};
  let cantonAudited = 0;
  let cantonNetwork = 0;

  for (const district of DISTRICTS) {
    const raw = await loadRaw(district, { refresh });
    const { features, stats } = districtFeatures(district, raw, claimed);
    allFeatures.push(...features);
    districtStats[district.districtId] = stats;
    cantonAudited += stats.audited_km;
    cantonNetwork += stats.network_km;
    console.log(
      `[import] ${district.key}: ${stats.segment_count} segments ` +
        `(${stats.audited_km} km audited / ${stats.network_km} km network, ${stats.coverage_pct}% coverage)`,
    );
  }

  const collection = {
    type: "FeatureCollection",
    metadata: {
      source: "OpenStreetMap via Overpass API",
      license: "ODbL 1.0",
      canton: CANTON_NAME,
      canton_id: CANTON_ID,
      generated_at: new Date().toISOString(),
      segment_count: allFeatures.length,
      audited_km: Number(cantonAudited.toFixed(2)),
      network_km: Number(cantonNetwork.toFixed(2)),
      coverage_pct:
        cantonNetwork > 0
          ? Number(((cantonAudited / cantonNetwork) * 100).toFixed(1))
          : 100,
      districts: districtStats,
    },
    features: allFeatures,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(collection, null, 2));

  console.log(
    `[import] wrote ${allFeatures.length} segments across ${DISTRICTS.length} districts ` +
      `(${collection.metadata.audited_km} km audited / ${collection.metadata.network_km} km network) -> ${OUT_PATH}`,
  );

  if (allFeatures.length < 40) {
    console.error(
      `[import] WARNING: only ${allFeatures.length} segments (<40). Check the Overpass responses.`,
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
