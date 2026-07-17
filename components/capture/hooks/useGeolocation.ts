"use client";

/**
 * The GPS watch.
 *
 * Every fix the device reports is handed to `onFix` and none are filtered here.
 * That is deliberate: `capture_sessions` stores the raw track, accuracy included,
 * and the server drops poor fixes at match time. A client that quietly discarded
 * its own bad fixes would be editing evidence, and the walker would never learn
 * that their walk was recorded through a concrete garage.
 *
 * The UI's job is to warn at `accuracyWarnM`; the recorder's job is to record
 * what happened.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackPoint } from "@/lib/capture/types";

export type GeolocationErrorReason = "denied" | "unavailable" | "timeout" | "unsupported";

export type GeolocationState = {
  status: "idle" | "watching" | "error";
  /** Most recent fix, for the live accuracy readout. */
  latest: TrackPoint | null;
  reason: GeolocationErrorReason | null;
};

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function toTrackPoint(position: GeolocationPosition): TrackPoint {
  const { coords } = position;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    // `position.timestamp` is epoch ms and is what the contract wants. Reading
    // Date.now() here instead would silently paper over a wrong device clock,
    // which is exactly what capture_sessions.clock_offset_ms exists to record.
    t: position.timestamp,
    ...(typeof coords.accuracy === "number" ? { accuracy: coords.accuracy } : {}),
    ...(typeof coords.heading === "number" && !Number.isNaN(coords.heading)
      ? { heading: coords.heading }
      : {}),
    ...(typeof coords.speed === "number" && !Number.isNaN(coords.speed)
      ? { speed: coords.speed }
      : {}),
  };
}

export function useGeolocation(
  options: Readonly<{ enabled: boolean; onFix?: (point: TrackPoint) => void }>,
) {
  const { enabled } = options;

  // Only the two things that genuinely arrive from outside React are state. The
  // status is derived below rather than stored, which is what keeps setState out
  // of the effect body entirely (see `useContribute.ts` for the same rule).
  // Feature support is read once during render, not in an effect: it cannot
  // change, and this whole tree is mounted client-only, so there is no hydration
  // pass to disagree with.
  const [supported] = useState(() => isGeolocationSupported());
  const [latest, setLatest] = useState<TrackPoint | null>(null);
  const [reason, setReason] = useState<GeolocationErrorReason | null>(null);

  // The callback is stashed in a ref so a caller passing an inline arrow does
  // not tear down and re-establish the GPS watch on every render. Restarting
  // watchPosition costs a fresh acquisition, which on a phone is seconds of
  // walking with no fixes.
  const onFixRef = useRef(options.onFix);
  useEffect(() => {
    onFixRef.current = options.onFix;
  }, [options.onFix]);

  useEffect(() => {
    if (!enabled || !supported) return;

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const point = toTrackPoint(position);
        setLatest(point);
        setReason(null);
        onFixRef.current?.(point);
      },
      (error) => {
        setReason(
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable",
        );
        // `latest` is deliberately left alone: losing the signal under a canopy
        // should not blank the last known accuracy out from under the walker.
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        // Generous: indoors, a first fix genuinely can take this long, and a
        // timeout here is reported as an error state the walker can act on.
        timeout: 30_000,
      },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, supported]);

  const state: GeolocationState = {
    status: !supported || reason !== null ? "error" : enabled ? "watching" : "idle",
    latest,
    reason: supported ? reason : "unsupported",
  };

  const reset = useCallback(() => {
    setLatest(null);
    setReason(null);
  }, []);

  return { state, reset };
}
