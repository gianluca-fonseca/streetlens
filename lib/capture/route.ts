/**
 * Associating a video with a route someone drew or uploaded.
 *
 * The obvious way to do this is to walk the frames and place each one along the
 * path. That way is wrong, and the inversion here is the whole point of the
 * file: instead of distributing FRAMES along the path, we time-stamp the route's
 * VERTICES, and then `interpolateAt` from `./track` places every frame for free,
 * using exactly the same code path a live GPS track uses. A video route and a
 * walked route become the same kind of object the moment they leave this file,
 * and the matcher, the frame placer and the review UI never learn the
 * difference.
 *
 * The price is one assumption: constant pace. A vertex's timestamp is its
 * cumulative distance along the path as a fraction of the total, scaled across
 * the video's span. If the contributor stopped at a light for thirty seconds,
 * this is wrong by thirty seconds' worth of street. That assumption is real and
 * it is unavoidable without a GPS trace, but the value of the inversion is that
 * it lives in ONE function, stated out loud, rather than smeared across a frame
 * loop where nobody would find it. The clock-nudge UI exists because of it.
 *
 * Pure: no I/O, no clock.
 */

import type { TrackPoint } from "./types";

export type LatLng = Readonly<{ lat: number; lng: number }>;

/**
 * A local haversine rather than an import.
 *
 * `components/capture/engine/geo.ts` has an identical one, and reaching for it
 * would be the repo's first `lib/` → `components/` import: the dependency runs
 * the wrong way, and it would drag a browser-recorder module into a server
 * route. `lib/matching/graph.ts` also exports one, but it takes GeoJSON
 * `Position` tuples and lives behind an RBush import, which is a heavy thing to
 * pull in for one formula. Both existing copies are already per-layer, so a
 * third one here follows the convention rather than breaking it. The duplication
 * is ten lines of arithmetic that will never change; the coupling would not be
 * so cheap.
 */
const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const latA = a.lat * DEG_TO_RAD;
  const latB = b.lat * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in metres, summed vertex to vertex. Zero for 0 or 1 vertices. */
export function pathLengthMeters(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineMeters(path[i - 1]!, path[i]!);
  }
  return total;
}

/** Cumulative distance at each vertex, `cum[0] === 0`. */
function cumulativeMeters(path: readonly LatLng[]): number[] {
  const cum: number[] = new Array(path.length).fill(0);
  for (let i = 1; i < path.length; i += 1) {
    cum[i] = cum[i - 1]! + haversineMeters(path[i - 1]!, path[i]!);
  }
  return cum;
}

/**
 * Time-stamp a route's vertices across `[startT, endT]`, proportional to
 * distance travelled.
 *
 * Vertex i gets `startT + (cumDist_i / totalDist) * (endT - startT)`, so the
 * first vertex lands exactly on startT and the last exactly on endT (no float
 * drift at the ends: they are assigned, not computed). Hand the result to
 * `validateTrack(track, "trace")` and then `interpolateAt(track, frameT)` for
 * each frame. See the file header for why it works this way round.
 *
 * Three degenerate inputs, all of which a UI can produce:
 *
 * - Fewer than two vertices. A single vertex gets startT and comes back alone;
 *   an empty path comes back empty. Neither survives `validateTrack`, which is
 *   correct: a point is not a route, and this is not the layer that should be
 *   deciding that.
 * - Every vertex coincident, so total distance is 0. Dividing by it would give
 *   NaN for every timestamp, so times are spread evenly by INDEX instead. The
 *   result is meaningless as geography and defined as data, which is what the
 *   caller needs to render an error rather than a crash.
 * - `endT <= startT`. The span is clamped to zero and every vertex gets startT,
 *   because a video with no duration gives us nothing to distribute. We do not
 *   invent a duration to make the output look healthier than the input was.
 *
 * `accuracy` is deliberately never set. A synthesized route has no honest
 * accuracy figure, and `validateTrack` KEEPS a fix that reports none, so
 * omitting it is both truthful and safe. Inventing one would be a lie with
 * teeth: anything above `MAX_ACCURACY_M` (25) would silently drop the fix and
 * the route would come apart for a reason nobody could trace back to here.
 */
export function distributeTimesAlongPath(
  path: readonly LatLng[],
  startT: number,
  endT: number,
): TrackPoint[] {
  if (path.length === 0) return [];
  if (path.length === 1) return [{ lat: path[0]!.lat, lng: path[0]!.lng, t: startT }];

  const span = Math.max(0, endT - startT);
  const cum = cumulativeMeters(path);
  const total = cum[cum.length - 1]!;
  const last = path.length - 1;

  return path.map((p, i) => {
    if (i === 0) return { lat: p.lat, lng: p.lng, t: startT };
    if (i === last) return { lat: p.lat, lng: p.lng, t: startT + span };
    const fraction = total > 0 ? cum[i]! / total : i / last;
    return { lat: p.lat, lng: p.lng, t: startT + fraction * span };
  });
}

/**
 * The point at `fraction` (0..1) of the path's total length.
 *
 * This is the clock-nudge preview's read model: as the contributor drags the
 * start time, the UI asks "where would this frame land now" and draws a marker.
 * It measures by DISTANCE, not by vertex index, so it agrees with
 * `distributeTimesAlongPath` on a path whose vertices are unevenly spaced (which
 * every hand-drawn path is).
 *
 * Fraction is clamped to [0,1] rather than refused: a slider overshooting its
 * own ends by a rounding error should show the endpoint, not vanish. A
 * non-finite fraction is read as 0 for the same reason. Null only for an empty
 * path, which is the one case with no point to return.
 */
export function positionAtFraction(path: readonly LatLng[], fraction: number): LatLng | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0]!;

  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const cum = cumulativeMeters(path);
  const total = cum[cum.length - 1]!;
  // A path that goes nowhere has no interior to interpolate; every fraction of
  // it is the same place.
  if (total <= 0) return path[0]!;

  const target = f * total;
  for (let i = 1; i < path.length; i += 1) {
    if (cum[i]! < target) continue;
    const legStart = cum[i - 1]!;
    const leg = cum[i]! - legStart;
    // A repeated vertex contributes a zero-length leg; it sits exactly at the
    // target, so return it rather than dividing by zero.
    if (leg <= 0) return path[i]!;
    const legF = (target - legStart) / leg;
    const a = path[i - 1]!;
    const b = path[i]!;
    return { lat: a.lat + (b.lat - a.lat) * legF, lng: a.lng + (b.lng - a.lng) * legF };
  }

  return path[path.length - 1]!;
}
