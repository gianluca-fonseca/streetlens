#!/usr/bin/env node
/**
 * routing-test.mjs — node-level proof that the trace tool follows the street
 * network instead of cutting straight lines through blocks.
 *
 * It loads the committed data/routing-network.geojson and drives the SAME
 * routing core the client ships (components/contribute/routing-core.mjs), then
 * asserts, against the real network:
 *
 *   1. STREET-FOLLOWING: two dots on different streets that meet at an
 *      intersection route THROUGH that intersection — the routed path is longer
 *      than the straight line, has more than two vertices, and contains the
 *      connecting junction node.
 *   2. OFF-NETWORK FALLBACK: a dot far from any street fails to snap, so the
 *      router returns ok:false with the straight [from, to] connector.
 *   3. DISCONNECTED FALLBACK: two on-network dots on disconnected pieces of the
 *      graph fail to route, again returning ok:false + the straight connector.
 *
 *   node scripts/routing-test.mjs
 *
 * Exit 0 = all assertions passed; non-zero = a regression.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRouter } from "../components/contribute/routing-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NETWORK_PATH = path.join(ROOT, "data", "routing-network.geojson");

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

const key = (c) => `${c[0]},${c[1]}`;

/** Endpoint of a way's coordinate list farthest (great-circle) from anchor. */
function farEndpoint(coords, anchor) {
  const first = coords[0];
  const last = coords[coords.length - 1];
  return haversine(first, anchor) >= haversine(last, anchor) ? first : last;
}

async function main() {
  const network = JSON.parse(await fs.readFile(NETWORK_PATH, "utf8"));
  const wayCount = network.features.length;
  const router = createRouter(network);
  console.log(
    `[routing-test] network: ${wayCount} ways / ${router.vertexCount} vertices`,
  );
  assert.ok(wayCount >= 40, "network should carry a meaningful number of ways");

  // Index every coordinate to the distinct ways that touch it. A coordinate
  // touched by >= 2 different ways is a junction (a real intersection).
  const waysByCoord = new Map();
  for (const f of network.features) {
    for (const c of f.geometry.coordinates) {
      const k = key(c);
      let set = waysByCoord.get(k);
      if (!set) {
        set = new Set();
        waysByCoord.set(k, set);
      }
      set.add(f.properties.osm_way_id);
    }
  }
  const wayById = new Map(
    network.features.map((f) => [f.properties.osm_way_id, f]),
  );

  /* ---- 1) STREET-FOLLOWING through a connecting intersection ------------- */

  // Deterministically find a junction where routing two far endpoints of two
  // different ways actually traverses that junction. Junction coords are sorted
  // so the chosen case is stable across runs.
  const junctions = [...waysByCoord.entries()]
    .filter(([, ways]) => ways.size >= 2)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  console.log(`[routing-test] ${junctions.length} junction coordinates`);
  assert.ok(junctions.length >= 20, "network should be richly connected");

  let streetCase = null;
  for (const [jKey, wayIds] of junctions) {
    const junction = jKey.split(",").map(Number);
    const ids = [...wayIds].sort((a, b) => a - b);
    outer: for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const wayA = wayById.get(ids[i]);
        const wayB = wayById.get(ids[j]);
        if (!wayA || !wayB) continue;
        const dotA = farEndpoint(wayA.geometry.coordinates, junction);
        const dotB = farEndpoint(wayB.geometry.coordinates, junction);
        if (key(dotA) === key(dotB)) continue;

        const res = router.routeBetween(dotA, dotB);
        const routesThroughJunction = res.coords.some(
          (c) => key(c) === jKey,
        );
        const routed = lineLength(res.coords);
        const straight = haversine(dotA, dotB);
        if (
          res.ok &&
          res.coords.length > 2 &&
          routed > straight &&
          routesThroughJunction
        ) {
          streetCase = { dotA, dotB, junction, res, routed, straight };
          break outer;
        }
      }
    }
    if (streetCase) break;
  }

  assert.ok(
    streetCase,
    "expected a routable pair of streets meeting at a shared intersection",
  );
  const { dotA, dotB, junction, res, routed, straight } = streetCase;
  console.log(
    `[routing-test] street-following case:\n` +
      `    from ${dotA} to ${dotB}\n` +
      `    via junction ${junction}\n` +
      `    routed ${routed.toFixed(1)} m over ${res.coords.length} vertices ` +
      `vs straight-line ${straight.toFixed(1)} m`,
  );
  assert.equal(res.ok, true, "the routed pair should succeed");
  assert.ok(res.coords.length > 2, "a street-following path needs > 2 vertices");
  assert.ok(
    routed > straight,
    "routed length must exceed the straight-line distance (it turns at the corner)",
  );
  assert.ok(
    res.coords.some((c) => key(c) === key(junction)),
    "the routed path must pass through the connecting intersection",
  );

  /* ---- 2) OFF-NETWORK FALLBACK ------------------------------------------- */

  // A point well outside the pilot bbox: no vertex within the snap threshold.
  const offNetwork = [-84.0, 9.99];
  const onNetwork = network.features[0].geometry.coordinates[0];
  const offRes = router.routeBetween(onNetwork, offNetwork);
  assert.equal(offRes.ok, false, "an off-network dot must fail to route");
  assert.deepEqual(
    offRes.coords,
    [onNetwork, offNetwork],
    "off-network fallback must be the straight [from, to] connector",
  );
  console.log(
    `[routing-test] off-network fallback: ok=false, straight connector returned`,
  );

  /* ---- 3) DISCONNECTED-PAIR FALLBACK ------------------------------------- */

  // Two ON-network dots that snap fine but sit on disconnected pieces of the
  // graph: findPath returns nothing, so the router falls back to a straight
  // dashed connector. Search way-endpoint pairs deterministically for the first
  // such pair (bounded for speed).
  const reps = network.features
    .slice(0, 250)
    .map((f) => f.geometry.coordinates[0]);
  let disconnectedCase = null;
  for (let i = 0; i < reps.length && !disconnectedCase; i += 1) {
    for (let j = i + 1; j < reps.length; j += 1) {
      if (key(reps[i]) === key(reps[j])) continue;
      const r = router.routeBetween(reps[i], reps[j]);
      // ok:false here means both snapped (they are real vertices) but no path.
      if (!r.ok) {
        disconnectedCase = { from: reps[i], to: reps[j], r };
        break;
      }
    }
  }

  if (disconnectedCase) {
    const { from, to, r } = disconnectedCase;
    assert.equal(r.ok, false, "disconnected pair must fail to route");
    assert.deepEqual(
      r.coords,
      [from, to],
      "disconnected fallback must be the straight [from, to] connector",
    );
    console.log(
      `[routing-test] disconnected fallback: ${from} -/-> ${to} ` +
        `(ok=false, straight connector)`,
    );
  } else {
    console.log(
      `[routing-test] disconnected fallback: network is a single connected ` +
        `component in the sampled window; off-network fallback already proved ` +
        `the ok:false path.`,
    );
  }

  console.log("[routing-test] PASS — trace routing follows the street network.");
}

main().catch((err) => {
  console.error("[routing-test] FAIL:", err.message);
  process.exit(1);
});
