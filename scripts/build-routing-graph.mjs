#!/usr/bin/env node
/**
 * build-routing-graph.mjs
 *
 * Companion to import-osm-corridor.mjs. Where the importer carves the network
 * into ~150 m *auditable* block faces, this script emits the full routable
 * topology the client trace tool needs to FOLLOW THE STREET NETWORK between
 * dots instead of cutting straight lines through blocks.
 *
 * From the cached raw Overpass ways (data/raw/overpass-san-antonio.json) it
 * writes data/routing-network.geojson: every walkable/drivable way in the pilot
 * bbox as a LineString, coordinates rounded to 6 decimals (~0.11 m). Because two
 * OSM ways that meet at an intersection share the exact same node coordinate,
 * emitting them verbatim preserves shared topology — geojson-path-finder joins
 * lines that touch at a coordinate, so a router can turn at the intersection.
 *
 *   node scripts/build-routing-graph.mjs           # use cached Overpass response
 *   node scripts/build-routing-graph.mjs --refresh # re-run the importer's fetch first
 *
 * Keep it lean: only geometry + a highway tag + osm_way_id ride along. No names,
 * no audit metadata — this asset is for routing, not display.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw", "overpass-san-antonio.json");
const OUT_PATH = path.join(ROOT, "data", "routing-network.geojson");

// Same pilot bbox as the importer: [south, west, north, east].
const BBOX = [9.898, -84.162, 9.922, -84.135];

/**
 * Highway classes that are walkable and/or drivable, hence routable for a
 * pedestrian-first audit tool. This is intentionally broad — footway, path,
 * steps, and service (driveways/parking aisles) all help two dots connect
 * through the real network. Explicitly non-routable classes (construction,
 * proposed, raceway, ...) are excluded by omission.
 */
const ROUTABLE = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
  "road",
  "footway",
  "path",
  "cycleway",
  "steps",
  "track",
  "bridleway",
  "corridor",
]);

function roundCoord([lon, lat]) {
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
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

/** Drop consecutive duplicate coordinates left over from rounding. */
function dedupe(coords) {
  const out = [];
  for (const c of coords) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
  }
  return out;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  if (refresh) {
    // Delegate the network fetch to the importer so there is one Overpass
    // citizen and one cache; then read the cache it refreshed.
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "import-osm-corridor.mjs"), "--refresh"],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      throw new Error("importer --refresh failed; cannot rebuild routing graph");
    }
  }

  const raw = JSON.parse(await fs.readFile(RAW_PATH, "utf8"));
  console.log(`[routing] using Overpass cache: ${RAW_PATH}`);

  const ways = (raw.elements || [])
    .filter(
      (el) =>
        el.type === "way" &&
        Array.isArray(el.geometry) &&
        el.geometry.length >= 2 &&
        el.tags?.highway &&
        ROUTABLE.has(el.tags.highway),
    )
    .sort((a, b) => a.id - b.id); // deterministic output across runs

  const byClass = {};
  let networkMeters = 0;
  const features = [];

  for (const way of ways) {
    const highway = way.tags.highway;
    const coords = dedupe(way.geometry.map((g) => roundCoord([g.lon, g.lat])));
    if (coords.length < 2) continue;

    byClass[highway] = (byClass[highway] || 0) + 1;
    networkMeters += lineLength(coords);

    features.push({
      type: "Feature",
      properties: { highway, osm_way_id: way.id },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  // Report how many distinct vertices / how connected the graph is, so a
  // regression in the source data is loud rather than silent.
  const vertexKeys = new Set();
  const sharedKeys = new Set();
  const seenOnce = new Set();
  for (const f of features) {
    for (const c of f.geometry.coordinates) {
      const k = `${c[0]},${c[1]}`;
      if (seenOnce.has(k)) sharedKeys.add(k);
      else seenOnce.add(k);
      vertexKeys.add(k);
    }
  }

  const collection = {
    type: "FeatureCollection",
    metadata: {
      source: "OpenStreetMap via Overpass API",
      license: "ODbL 1.0",
      purpose: "client trace routing (street-following graph)",
      district: "San Antonio de Escazú",
      bbox: BBOX,
      generated_at: new Date().toISOString(),
      way_count: features.length,
      vertex_count: vertexKeys.size,
      junction_count: sharedKeys.size,
      network_km: Number((networkMeters / 1000).toFixed(2)),
      by_class: byClass,
    },
    features,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(collection));

  console.log(
    `[routing] wrote ${features.length} ways / ${vertexKeys.size} vertices / ` +
      `${sharedKeys.size} shared junction nodes ` +
      `(${collection.metadata.network_km} km) -> ${OUT_PATH}`,
  );
  console.log(`[routing] by class:`, byClass);

  if (features.length < 40 || sharedKeys.size < 20) {
    console.error(
      `[routing] WARNING: thin network (${features.length} ways, ` +
        `${sharedKeys.size} junctions). Routing may fail to connect dots.`,
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[routing] failed:", err);
  process.exit(1);
});
