"use client";

/**
 * Keeps the screen awake while recording.
 *
 * A wake lock is released by the browser whenever the page stops being visible,
 * and it is NOT restored on return. So re-acquiring on `visibilitychange` is not
 * a nicety, it is the whole feature: without it the lock silently dies the first
 * time the walker checks a message and the screen sleeps for the rest of the walk.
 *
 * The lock is best-effort by design. Low-power mode on iOS refuses it outright,
 * and a walk with a sleeping screen is still a walk worth recording. The state is
 * surfaced so the UI can tell the truth ("keep the screen on yourself") rather
 * than failing the session.
 */

import { useEffect, useRef, useState } from "react";

export type WakeLockStatus = "unsupported" | "idle" | "active" | "failed";

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export function useWakeLock(enabled: boolean) {
  // Support is fixed for the life of the page and this tree is client-only, so
  // it is read once during render. `held` is the only real state; the public
  // status is derived, which keeps setState out of the effect body.
  const [supported] = useState(() => isWakeLockSupported());
  const [held, setHeld] = useState<"idle" | "active" | "failed">("idle");
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!supported || !enabled) return;

    let cancelled = false;

    const acquire = async () => {
      // Requesting while hidden always throws; the visibility listener below
      // picks it up on return. This is the re-acquire path that makes the lock
      // survive the walker glancing at a message.
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinelRef.current !== null) return;

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        setHeld("active");
        // Fires when the UA drops the lock itself, e.g. on backgrounding.
        // Clearing the ref is precisely what lets the re-acquire path work.
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // iOS low-power mode refuses outright. A walk with a sleeping screen is
        // still a walk; the UI tells the truth instead of failing the session.
        if (!cancelled) setHeld("failed");
      }
    };

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled, supported]);

  const status: WakeLockStatus = !supported ? "unsupported" : enabled ? held : "idle";
  return status;
}
