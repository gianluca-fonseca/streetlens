/**
 * Capture vantage from track speed — pedestrian vs vehicle.
 *
 * Vehicle capture is a first-class mode (0030), but the extraction stack was
 * tuned for sidewalk-adjacent pedestrian video. Oblique road-center frames need
 * the stronger model as primary: nano demonstrably misses raised sidewalks that
 * are plain to a human reviewer (owner evidence: Calle Palomas frame 14).
 *
 * Speed is computed from consecutive timed track fixes (median inter-fix m/s).
 * Threshold ~3 m/s sits above a brisk walk / jog and below any real drive.
 * When the track cannot be timed, we fail closed to pedestrian (nano-first).
 */

/** Metres per second: median inter-fix speed above this → vehicle vantage. */
export const VEHICLE_SPEED_THRESHOLD_MPS = 3;

export type CaptureVantage = "pedestrian" | "vehicle";

export type TimedFix = {
  lng: number;
  lat: number;
  /** Epoch ms. */
  t: number;
};

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Median of consecutive inter-fix speeds (m/s). Null when fewer than two
 * usable intervals exist.
 */
export function medianInterfixSpeedMps(track: readonly TimedFix[]): number | null {
  if (track.length < 2) return null;

  const sorted = [...track].sort((a, b) => a.t - b.t);
  const speeds: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const dtS = (b.t - a.t) / 1000;
    if (!(dtS > 0)) continue;
    const dist = haversineM(a, b);
    if (!(dist >= 0) || !Number.isFinite(dist)) continue;
    speeds.push(dist / dtS);
  }
  if (speeds.length === 0) return null;

  speeds.sort((x, y) => x - y);
  const mid = Math.floor(speeds.length / 2);
  return speeds.length % 2 === 1
    ? speeds[mid]!
    : (speeds[mid - 1]! + speeds[mid]!) / 2;
}

/**
 * Classify a session's capture vantage from its timed track.
 *
 * `thresholdMps` defaults to VEHICLE_SPEED_THRESHOLD_MPS; override only in tests.
 */
export function classifyCaptureVantage(
  track: readonly TimedFix[],
  thresholdMps: number = VEHICLE_SPEED_THRESHOLD_MPS,
): CaptureVantage {
  const speed = medianInterfixSpeedMps(track);
  if (speed === null) return "pedestrian";
  return speed > thresholdMps ? "vehicle" : "pedestrian";
}

/**
 * Rebuild a timed track from stored geometry (no per-vertex times survive
 * finalize) and frame capture times. Distributes the frame time span along the
 * path by cumulative distance — enough to recover median inter-fix speed for
 * vantage routing without a schema migration.
 */
export function timedTrackFromVertsAndFrames(
  trackVerts: readonly { lng: number; lat: number }[],
  frames: readonly { t: number }[],
): TimedFix[] {
  if (trackVerts.length === 0 || frames.length === 0) return [];
  const times = frames.map((f) => f.t).filter((t) => Number.isFinite(t));
  if (times.length === 0) return [];
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const span = tMax - tMin;

  const cum = [0];
  for (let i = 1; i < trackVerts.length; i++) {
    cum.push(cum[i - 1]! + haversineM(trackVerts[i - 1]!, trackVerts[i]!));
  }
  const total = cum[cum.length - 1]!;

  return trackVerts.map((v, i) => {
    const frac = total > 0 ? cum[i]! / total : 0;
    return { lng: v.lng, lat: v.lat, t: Math.round(tMin + frac * span) };
  });
}
