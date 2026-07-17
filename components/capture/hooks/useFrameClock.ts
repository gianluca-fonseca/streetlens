"use client";

/**
 * Drives one callback per decoded video frame, and only while the page is
 * genuinely visible.
 *
 * The visibility gate is the important part and it is a HARD gate, not an
 * optimisation. iOS keeps handing back the last decoded frame from a hidden
 * video instead of stopping, so a backgrounded tab does not go quiet, it goes
 * *stale*: it happily produces frames that look real, carry a current timestamp,
 * and are pinned to whatever GPS fix arrives while the phone is in a pocket.
 * That is fabricated data. We would rather record nothing.
 *
 * `requestVideoFrameCallback` is the right clock because it fires per decoded
 * frame. Where it is missing we fall back to rAF plus a `currentTime` check,
 * since rAF fires on the compositor's schedule and would otherwise hand the same
 * frame to the gates several times over.
 */

import { useEffect, useRef, type RefObject } from "react";

export function useFrameClock(
  options: Readonly<{
    videoRef: RefObject<HTMLVideoElement | null>;
    enabled: boolean;
    /** Receives epoch ms. Not the rVFC media timestamp: frames are stamped in wall-clock. */
    onFrame: (now: number) => void;
  }>,
) {
  const { videoRef, enabled } = options;

  // Ref, so an inline arrow from the caller does not restart the clock every
  // render and drop frames on the floor.
  const onFrameRef = useRef(options.onFrame);
  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;

    const hasRvfc = typeof video.requestVideoFrameCallback === "function";
    let cancelled = false;
    let handle: number | null = null;
    let lastCurrentTime = -1;

    const schedule = () => {
      if (cancelled) return;
      handle = hasRvfc
        ? video.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    };

    const tick = () => {
      if (cancelled) return;

      if (document.visibilityState === "visible") {
        // Under the rAF fallback the same decoded frame is presented many times;
        // only a moved playhead means new pixels.
        const isNewFrame = hasRvfc || video.currentTime !== lastCurrentTime;
        lastCurrentTime = video.currentTime;
        if (isNewFrame) onFrameRef.current(Date.now());
      }

      schedule();
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle === null) return;
      if (hasRvfc) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [enabled, videoRef]);
}
