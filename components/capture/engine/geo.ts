/**
 * Distance helpers for the live recorder.
 *
 * The repo already depends on `@turf/distance`, but the displacement gate runs
 * on every GPS fix and every candidate frame on a phone that is also decoding
 * video, so this keeps a dependency-free haversine on that path rather than
 * allocating a GeoJSON Feature per comparison. Turf remains the right tool for
 * the analysis pipeline; this is the hot loop.
 */

import type { TrackPoint } from "@/lib/capture/types";

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

/** Great-circle distance in metres between two lat/lng pairs. */
export function haversineMeters(
  a: Readonly<{ lat: number; lng: number }>,
  b: Readonly<{ lat: number; lng: number }>,
): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const latA = a.lat * DEG_TO_RAD;
  const latB = b.lat * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Total walked distance along a track, in metres.
 *
 * Summed pairwise over the raw fixes with no smoothing, so a jittery GPS reads
 * slightly long. That is the honest number to show a walker: it is the distance
 * their device believes it covered, not a cleaned-up estimate. Server-side
 * matching does the smoothing.
 */
export function trackDistanceMeters(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/** Metres formatted for a HUD: `840 m` under a km, `1.2 km` over. */
export function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

/** Elapsed milliseconds as `M:SS`, or `H:MM:SS` once it runs past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
