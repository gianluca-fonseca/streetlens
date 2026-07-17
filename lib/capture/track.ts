/**
 * Track hygiene: what finalize does to a raw GPS track before it reaches the
 * matcher, and where a frame sat when it was shot.
 *
 * Pure — no I/O, no clock. The zod layer (lib/capture/schemas.ts) has already
 * checked that each fix is structurally sane; this file decides whether the
 * track is USABLE, which is a different question and a judgement call.
 */

import type { TrackPoint, TrackSource } from "./types";

/**
 * Fixes worse than this (metres of reported horizontal accuracy) are dropped.
 *
 * 25 m is chosen against the matcher's 30 m gate (lib/matching/types.ts): a fix
 * whose own error bar exceeds the gate cannot discriminate between two parallel
 * streets, so it is noise that would drag a match sideways rather than evidence.
 * A fix that reports no accuracy at all is KEPT — plenty of devices omit it, and
 * treating silence as failure would throw away most GPX imports.
 */
export const MAX_ACCURACY_M = 25;

/** A live track needs this many fixes... */
export const MIN_LIVE_FIXES = 10;
/** ...spanning at least this long. */
export const MIN_LIVE_SPAN_MS = 30_000;

export type TrackValidation =
  | { ok: true; track: TrackPoint[]; dropped: number }
  | { ok: false; reason: string; dropped: number };

/**
 * Drop unusable fixes and decide whether what remains is a real track.
 *
 * The fix-count and duration floors apply to `live` only. A `gpx`/`trace` import
 * is a deliberate upload of a route someone already has — it may be sparse (a
 * handful of vertices for a long street) without being untrustworthy, and
 * holding it to a live capture's sampling rate would reject good data for the
 * wrong reason.
 *
 * Fixes are sorted by time: a device that emits a late fix out of order is
 * common, and the matcher assumes chronological input.
 */
export function validateTrack(track: TrackPoint[], source: TrackSource): TrackValidation {
  const kept = track.filter((p) => p.accuracy === undefined || p.accuracy <= MAX_ACCURACY_M);
  const dropped = track.length - kept.length;

  if (kept.length < 2) {
    return { ok: false, reason: "track_too_short_after_accuracy_filter", dropped };
  }

  const sorted = [...kept].sort((a, b) => a.t - b.t);

  if (source === "live") {
    if (sorted.length < MIN_LIVE_FIXES) {
      return { ok: false, reason: "insufficient_fixes", dropped };
    }
    const span = sorted[sorted.length - 1]!.t - sorted[0]!.t;
    if (span < MIN_LIVE_SPAN_MS) {
      return { ok: false, reason: "track_span_too_short", dropped };
    }
  }

  return { ok: true, track: sorted, dropped };
}

/**
 * Where the device was at time `t`, linearly interpolated between the
 * surrounding fixes.
 *
 * Returns null outside the track's time range rather than clamping to an
 * endpoint: a frame shot a minute before the track started was not at the
 * start, and pretending otherwise would invent a location the map then shows as
 * fact. Linear interpolation is honest at walking pace over a few seconds of
 * sampling, which is the only case this is used for.
 *
 * `track` must be sorted by `t` (validateTrack guarantees it).
 */
export function interpolateAt(
  track: readonly TrackPoint[],
  t: number,
): { lng: number; lat: number } | null {
  if (track.length === 0) return null;

  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (t < first.t || t > last.t) return null;

  // Binary search for the last fix at or before t.
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (track[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }

  const a = track[lo]!;
  if (lo === track.length - 1) return { lng: a.lng, lat: a.lat };

  const b = track[lo + 1]!;
  const span = b.t - a.t;
  // Two fixes sharing a timestamp: take the earlier rather than divide by zero.
  if (span <= 0) return { lng: a.lng, lat: a.lat };

  const f = (t - a.t) / span;
  return {
    lng: a.lng + (b.lng - a.lng) * f,
    lat: a.lat + (b.lat - a.lat) * f,
  };
}
