/**
 * Pure street-following routing core (plain ESM, no browser/React globals).
 *
 * Wraps `geojson-path-finder` (Dijkstra over GeoJSON LineString topology) with
 * turf nearest-vertex snapping. Kept as plain JS with a companion
 * `routing-core.d.mts` so BOTH the client wrapper (routing.ts) and the
 * node-level routing test import the exact same algorithm — the test needs no
 * TypeScript toolchain and cannot drift from what ships.
 *
 * Types live in routing-core.d.mts; see routing.ts for the fetch/memo wrapper.
 */

import PathFinderModule from "geojson-path-finder";
import { featureCollection, point } from "@turf/helpers";
import nearestPoint from "@turf/nearest-point";

// geojson-path-finder ships CommonJS; node's ESM interop hands back the module
// namespace (class under `.default`) while webpack unwraps to the class itself.
// Normalize so the same source runs in the test (node) and the client (webpack).
const PathFinder = PathFinderModule.default ?? PathFinderModule;

/** A dot farther than this (meters) from any network vertex is off-network. */
export const SNAP_THRESHOLD_M = 30;

function coordKey(c) {
  return `${c[0]},${c[1]}`;
}

/**
 * Build a router from an in-memory routing network. Pure and synchronous, so it
 * runs identically in node (the test) and the browser (the client).
 */
export function createRouter(network) {
  const finder = new PathFinder(network);

  // One point per distinct network vertex, for nearest-vertex snapping.
  const seen = new Set();
  const vertexFeatures = [];
  for (const feature of network.features) {
    for (const c of feature.geometry.coordinates) {
      const k = coordKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      vertexFeatures.push(point([c[0], c[1]]));
    }
  }
  const vertices = featureCollection(vertexFeatures);

  /** Snap a dot to the nearest network vertex within the threshold, else null. */
  function snap(dot) {
    if (vertexFeatures.length === 0) return null;
    const nearest = nearestPoint(point(dot), vertices, { units: "meters" });
    if (nearest.properties.distanceToPoint > SNAP_THRESHOLD_M) return null;
    const c = nearest.geometry.coordinates;
    return [c[0], c[1]];
  }

  /**
   * Route from one dot to the next through the street network. On success the
   * coords follow streets (turning at intersections); on failure they are the
   * straight [from, to] connector the caller renders dashed with a warning.
   */
  function routeBetween(from, to) {
    const a = snap(from);
    const b = snap(to);
    if (!a || !b) return { coords: [from, to], ok: false };

    // Both dots snapped to the same vertex: nothing to route, keep them joined.
    if (a[0] === b[0] && a[1] === b[1]) return { coords: [from, to], ok: true };

    const result = finder.findPath(point(a), point(b));
    if (!result || !result.path || result.path.length < 2) {
      // Disconnected pieces of the graph, or no route found.
      return { coords: [from, to], ok: false };
    }

    const coords = result.path.map((c) => [c[0], c[1]]);
    return { coords, ok: true };
  }

  return { routeBetween, vertexCount: vertexFeatures.length };
}
