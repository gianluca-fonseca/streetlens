/**
 * How densely to sample an uploaded video, and at which offsets.
 *
 * This is a separate module from `video-extract.ts` for one concrete reason:
 * testability. The extractor imports mp4box, which is ESM-only, and the repo's
 * test harness compiles TypeScript to CommonJS and `require()`s the result. A
 * `require()` of an ESM-only package throws, so any pure function that shares a
 * file with that import is untestable in the harness we actually have. The
 * sampling decision is the part most worth pinning with a test (it is arithmetic
 * with a cap and a rounding rule, and it decides how much of a street gets
 * covered), so it lives where a test can reach it.
 *
 * Nothing here touches the DOM, WebCodecs or a file. It is arithmetic.
 */

import { CAPTURE_LIMITS } from "@/lib/capture/types";

/** Ideal sampling interval: one frame a second, the same cadence as a live walk. */
export const IDEAL_INTERVAL_MS = 1_000;

/**
 * The sampling decision, made up front from the duration alone so the UI can be
 * honest about it before any decoding starts.
 */
export type ExtractionPlan = {
  durationMs: number;
  intervalMs: number;
  targetFrames: number;
  /**
   * True when the video is long enough that a frame a second would blow the
   * session cap, so the interval was stretched to fit. The UI must say this out
   * loud: the walker gets sparser coverage than they might expect, and silently
   * truncating at 400 instead would be worse.
   */
  sparser: boolean;
};

/**
 * Decide the sampling cadence.
 *
 * A 20 minute video at 1 fps is 1200 frames against a 400 frame cap, so the
 * interval stretches to 3 seconds and the whole street still gets covered. The
 * alternative (keep 1 fps, stop at 400) would silently cover the first seven
 * minutes and abandon the rest of the walk, which is a lie by omission: the
 * resulting map would show a street as surveyed when two thirds of it was never
 * looked at.
 */
export function planExtraction(
  durationMs: number,
  maxFrames: number = CAPTURE_LIMITS.maxFrames,
): ExtractionPlan {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const cap = Math.max(1, Math.floor(maxFrames));
  const idealCount = Math.floor(duration / IDEAL_INTERVAL_MS);

  if (idealCount <= cap) {
    return {
      durationMs: duration,
      intervalMs: IDEAL_INTERVAL_MS,
      // A video shorter than one interval still deserves its single frame.
      targetFrames: duration > 0 ? Math.max(idealCount, 1) : 0,
      sparser: false,
    };
  }

  const intervalMs = Math.ceil(duration / cap);
  return {
    durationMs: duration,
    intervalMs,
    // `floor` after the ceil'd interval can only ever land at or under the cap,
    // never over it. The cap is a hard contract with the server, not a target.
    targetFrames: Math.min(cap, Math.floor(duration / intervalMs)),
    sparser: true,
  };
}

/**
 * The times we want a frame at, in ms from the start of the video.
 *
 * Offset by half an interval rather than starting at zero. Frame zero of a phone
 * video is reliably the worst frame in it: exposure and focus are still settling,
 * and it is often the inside of a pocket. Half-interval offsets also stop the
 * sampling grid aligning with the GOP boundary, which would otherwise bias every
 * single sample toward keyframes and quietly measure a different thing than a
 * live walk does.
 */
export function sampleTargetsMs(plan: ExtractionPlan): number[] {
  const targets: number[] = [];
  for (let i = 0; i < plan.targetFrames; i += 1) {
    targets.push(Math.round(i * plan.intervalMs + plan.intervalMs / 2));
  }
  return targets;
}
