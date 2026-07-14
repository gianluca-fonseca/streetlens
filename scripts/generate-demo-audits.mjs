#!/usr/bin/env node
/**
 * generate-demo-audits.mjs
 *
 * Reads the real segment geometry from `data/segments.geojson` and paints
 * plausible DEMO audit scores over it, with spatial autocorrelation so the map
 * reads like real fieldwork rather than noise:
 *   - drainage degrades near quebradas (streams),
 *   - sidewalk accessibility degrades on steeper (uphill / southern) streets,
 *   - shade varies smoothly via value noise.
 *
 * Every feature is marked `demo: true`. Output is deterministic (fixed PRNG
 * seed) so re-runs are byte-identical.
 *
 * Writes:
 *   data/demo-segments.geojson  scored collection consumed by the fallback adapter + map
 *   data/demo-audits.json       per-segment audit + observation detail (getSegmentDetail)
 *   supabase/seed.sql           rubric v0.1 + geography + segments + demo audits/observations
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEGMENTS_PATH = path.join(ROOT, "data", "segments.geojson");
const DEMO_GEOJSON_PATH = path.join(ROOT, "data", "demo-segments.geojson");
const DEMO_AUDITS_PATH = path.join(ROOT, "data", "demo-audits.json");
const SEED_PATH = path.join(ROOT, "supabase", "seed.sql");

const RUBRIC_VERSION_ID = "v0.1";
const AUDIT_DATE = "2026-07-10";
const AUDITOR = "demo-generator";
const SEED = 0x51_7e_ec_a5;

// Approximate quebrada (stream) reference points inside the San Antonio bbox.
// Drainage scores dip near these.
const QUEBRADAS = [
  [-84.1512, 9.9068],
  [-84.1448, 9.9042],
  [-84.1387, 9.9095],
  [-84.1425, 9.9155],
];

// Latitude band of the bbox, used to model uphill steepness (south = higher).
const LAT_MIN = 9.898;
const LAT_MAX = 9.922;

/* -------------------------------------------------------------- *
 * Rubric v0.1 — data, not code. Bilingual, layer-mapped.
 * -------------------------------------------------------------- */
const RUBRIC_ITEMS = [
  { key: "sidewalk_present", layer: "accessibility", response_type: "boolean", label_en: "Sidewalk present", label_es: "Acera presente" },
  { key: "sidewalk_width", layer: "accessibility", response_type: "scale_0_4", label_en: "Sidewalk width ≥ 1.2 m", label_es: "Ancho de acera ≥ 1,2 m" },
  { key: "surface_condition", layer: "accessibility", response_type: "scale_0_4", label_en: "Sidewalk surface condition", label_es: "Estado de la superficie de la acera" },
  { key: "curb_ramp", layer: "accessibility", response_type: "boolean", label_en: "Curb ramp at crossing", label_es: "Rampa en el cruce" },
  { key: "obstruction_free", layer: "accessibility", response_type: "scale_0_4", label_en: "Path free of obstructions", label_es: "Paso libre de obstáculos" },
  { key: "drain_present", layer: "drainage", response_type: "boolean", label_en: "Storm drain / grate present", label_es: "Alcantarilla o rejilla presente" },
  { key: "standing_water", layer: "drainage", response_type: "scale_0_4", label_en: "No standing-water evidence", label_es: "Sin evidencia de encharcamiento" },
  { key: "curb_gutter", layer: "drainage", response_type: "scale_0_4", label_en: "Curb and gutter condition", label_es: "Estado de cordón y caño" },
  { key: "canopy_cover", layer: "shade", response_type: "percent", label_en: "Tree canopy coverage", label_es: "Cobertura de dosel arbóreo" },
  { key: "midday_shade", layer: "shade", response_type: "scale_0_4", label_en: "Shade at midday", label_es: "Sombra al mediodía" },
  { key: "lighting", layer: "overall", response_type: "scale_0_4", label_en: "Street lighting", label_es: "Iluminación pública" },
  { key: "crossing_safety", layer: "overall", response_type: "scale_0_4", label_en: "Crossing safety", label_es: "Seguridad en cruces" },
];

/* -------------------------------------------------------------- *
 * Deterministic PRNG + value noise
 * -------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Hash a lattice cell to a stable pseudo-random value in [0,1).
function hash2(ix, iy, salt) {
  let h = (ix * 374_761_393 + iy * 668_265_263 + salt * 2_246_822_519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Bilinear value noise over a lattice of `cells` degrees. Smooth => nearby
// segments get correlated values (spatial autocorrelation).
function valueNoise(lon, lat, salt, cells = 0.004) {
  const gx = lon / cells;
  const gy = lat / cells;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const v00 = hash2(x0, y0, salt);
  const v10 = hash2(x0 + 1, y0, salt);
  const v01 = hash2(x0, y0 + 1, salt);
  const v11 = hash2(x0 + 1, y0 + 1, salt);
  const a = v00 + fx * (v10 - v00);
  const b = v01 + fx * (v11 - v01);
  return a + fy * (b - a);
}

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

function midpoint(coords) {
  return coords[Math.floor(coords.length / 2)];
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

function nearestQuebradaMeters([lon, lat]) {
  let min = Infinity;
  for (const q of QUEBRADAS) {
    const d = haversine([lon, lat], q);
    if (d < min) min = d;
  }
  return min;
}

/* -------------------------------------------------------------- *
 * Scoring model
 * -------------------------------------------------------------- */
function scoreSegment(feature) {
  const coords = feature.geometry.coordinates;
  const mid = midpoint(coords);
  const [lon, lat] = mid;
  const highway = feature.properties.highway;

  // steepness proxy: further south (lower lat) => steeper/uphill => worse walk
  const steepness = clamp((LAT_MAX - lat) / (LAT_MAX - LAT_MIN), 0, 1);

  // quebrada proximity: 1 at the stream, decaying to 0 by ~350 m
  const qDist = nearestQuebradaMeters([lon, lat]);
  const quebradaProx = clamp(1 - qDist / 350, 0, 1);

  const nAccess = valueNoise(lon, lat, 11);
  const nDrain = valueNoise(lon, lat, 29);
  const nShade = valueNoise(lon, lat, 47);

  // Footways are pedestrian-first: a small accessibility bonus.
  const footBonus = highway === "footway" ? 8 : 0;

  const accessibility = clamp(
    74 - 34 * steepness + 22 * (nAccess - 0.5) + footBonus,
  );
  const drainage = clamp(80 - 46 * quebradaProx + 20 * (nDrain - 0.5));
  const shade = clamp(34 + 46 * nShade + 10 * (1 - steepness));

  const overall = clamp(
    0.45 * accessibility + 0.3 * drainage + 0.25 * shade,
  );

  return {
    overall: Math.round(overall),
    accessibility: Math.round(accessibility),
    drainage: Math.round(drainage),
    shade: Math.round(shade),
  };
}

// Map a 0..100 layer score to a per-item response, with light jitter.
function itemResponse(item, scores, rand) {
  const base = scores[item.layer] / 100;
  const jittered = clamp(base + (rand() - 0.5) * 0.18, 0, 1);
  switch (item.response_type) {
    case "boolean":
      return { raw: jittered > 0.45 ? 1 : 0, normalized: jittered > 0.45 ? 1 : 0 };
    case "percent":
      return { raw: Math.round(jittered * 100), normalized: jittered };
    case "scale_0_4":
    default:
      return { raw: Math.round(jittered * 4), normalized: Math.round(jittered * 4) / 4 };
  }
}

// Deterministic UUID (syntactically valid, stable per input) for seed audit ids.
function uuidFromString(input) {
  const h = createHash("md5").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sqlStr(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/* -------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------- */
async function main() {
  const raw = JSON.parse(await fs.readFile(SEGMENTS_PATH, "utf8"));
  const features = raw.features || [];
  if (features.length === 0) {
    throw new Error(
      "No segments in data/segments.geojson — run import-osm-corridor.mjs first.",
    );
  }
  const rand = mulberry32(SEED);

  const demoFeatures = [];
  const auditsById = {};

  // SQL accumulators
  const segmentInserts = [];
  const auditInserts = [];
  const observationInserts = [];

  for (const feature of features) {
    const props = feature.properties;
    const scores = scoreSegment(feature);
    const auditId = uuidFromString(`demo-audit-${props.id}`);

    demoFeatures.push({
      type: "Feature",
      properties: {
        id: props.id,
        name: props.name,
        score_overall: scores.overall,
        score_accessibility: scores.accessibility,
        score_drainage: scores.drainage,
        score_shade: scores.shade,
        demo: true,
      },
      geometry: feature.geometry,
    });

    const observations = RUBRIC_ITEMS.map((item) => {
      const { raw: rawResp, normalized } = itemResponse(item, scores, rand);
      const photos =
        item.key === "surface_condition" && normalized < 0.5
          ? [
              {
                storage_path: `demo/${props.id}/${item.key}.jpg`,
                taken_at: `${AUDIT_DATE}T15:00:00Z`,
              },
            ]
          : [];
      observationInserts.push(
        `  ('${auditId}', '${RUBRIC_VERSION_ID}:${item.key}', ${rawResp}, null)`,
      );
      return {
        item_key: item.key,
        label_en: item.label_en,
        label_es: item.label_es,
        layer: item.layer,
        response: Number(normalized.toFixed(3)),
        note: null,
        photos,
      };
    });

    auditsById[props.id] = {
      audited_on: AUDIT_DATE,
      auditor: AUDITOR,
      rubric_version_id: RUBRIC_VERSION_ID,
      highway: props.highway,
      length_m: props.length_m,
      scores,
      observations,
    };

    // SQL: segment (geometry via GeoJSON), audit
    const geomJson = JSON.stringify(feature.geometry).replace(/'/g, "''");
    segmentInserts.push(
      `  (${sqlStr(props.id)}, ${sqlStr(props.corridor_id)}, ${sqlStr(props.canton_id)}, ${sqlStr(props.district_id)}, ${sqlStr(props.name)}, ${sqlStr(props.highway)}, ${props.length_m}, ST_SetSRID(ST_GeomFromGeoJSON('${geomJson}'), 4326), true)`,
    );
    auditInserts.push(
      `  (${sqlStr(auditId)}, ${sqlStr(props.id)}, '${AUDIT_DATE}', ${sqlStr(AUDITOR)}, ${sqlStr(RUBRIC_VERSION_ID)}, true)`,
    );
  }

  // ---- write demo-segments.geojson ----
  const demoCollection = {
    type: "FeatureCollection",
    metadata: {
      ...raw.metadata,
      demo: true,
      note: "Synthetic demo scores over real OSM geometry. Not real measurements.",
      rubric_version_id: RUBRIC_VERSION_ID,
      scored_at: new Date().toISOString(),
    },
    features: demoFeatures,
  };
  await fs.writeFile(DEMO_GEOJSON_PATH, JSON.stringify(demoCollection, null, 2));

  // ---- write demo-audits.json ----
  await fs.writeFile(
    DEMO_AUDITS_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        demo: true,
        rubric_version_id: RUBRIC_VERSION_ID,
        audits: auditsById,
      },
      null,
      2,
    ),
  );

  // ---- write supabase/seed.sql ----
  const rubricItemValues = RUBRIC_ITEMS.map(
    (item, i) =>
      `  ('${RUBRIC_VERSION_ID}:${item.key}', '${RUBRIC_VERSION_ID}', ${sqlStr(item.key)}, ${sqlStr(item.label_en)}, ${sqlStr(item.label_es)}, ${sqlStr(item.layer)}, ${i + 1}, ${sqlStr(item.response_type)})`,
  );

  const seed = `-- seed.sql (generated by scripts/generate-demo-audits.mjs — do not edit by hand)
-- Rubric v0.1 + San Antonio de Escazú demo geography, segments, and demo audits.
-- All audit/segment rows are demo=true. Real fieldwork replaces them corridor by corridor.
-- Idempotent: safe to re-run.

begin;

insert into cantons (id, name) values ('esc', 'Escazú')
  on conflict (id) do nothing;

insert into districts (id, canton_id, name) values ('esc-san-antonio', 'esc', 'San Antonio')
  on conflict (id) do nothing;

insert into corridors (id, district_id, name) values ('esc-sa-corridor', 'esc-san-antonio', 'San Antonio pilot corridor')
  on conflict (id) do nothing;

insert into rubric_versions (id, label, frozen_at, is_active)
  values ('${RUBRIC_VERSION_ID}', 'StreetLens rubric v0.1 (pre-pilot)', now(), true)
  on conflict (id) do nothing;

insert into rubric_items (id, version_id, key, label_en, label_es, layer, ordering, response_type) values
${rubricItemValues.join(",\n")}
  on conflict (id) do nothing;

insert into segments (id, corridor_id, canton_id, district_id, name, highway, length_m, geom, demo) values
${segmentInserts.join(",\n")}
  on conflict (id) do nothing;

insert into audits (id, segment_id, audited_on, auditor, rubric_version_id, demo) values
${auditInserts.join(",\n")}
  on conflict (id) do nothing;

insert into observations (audit_id, item_id, response, note) values
${observationInserts.join(",\n")}
  on conflict (audit_id, item_id) do nothing;

commit;

-- Admin secret is NOT seeded here (never commit the real value). After migrating, run:
--   insert into app_secrets (key, value) values ('admin_rpc_secret', '<ADMIN_RPC_SECRET>')
--     on conflict (key) do update set value = excluded.value;
`;
  await fs.writeFile(SEED_PATH, seed);

  const failing = demoFeatures.filter(
    (f) => f.properties.score_accessibility < 50,
  ).length;
  console.log(
    `[demo] scored ${demoFeatures.length} segments; ${failing} fail Ley 7600 (accessibility < 50).`,
  );
  console.log(`[demo] wrote ${DEMO_GEOJSON_PATH}`);
  console.log(`[demo] wrote ${DEMO_AUDITS_PATH}`);
  console.log(`[demo] wrote ${SEED_PATH} (${observationInserts.length} observations)`);
}

main().catch((err) => {
  console.error("[demo] failed:", err);
  process.exit(1);
});
