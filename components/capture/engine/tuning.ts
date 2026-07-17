/**
 * Tuning constants for the live recorder.
 *
 * These are the knobs that decide what a walk actually yields. They live in one
 * file, apart from the React layer, so they are readable, testable and honest
 * about their provenance: the cadence and displacement gates come from the unit
 * brief, the JPEG settings from the storage contract, and the two vision
 * thresholds (`duplicateDelta`, `blurVariance`) are ESTIMATES that have not yet
 * been calibrated against real Escazú footage. See `.planning/evidence/u27/
 * MANUAL-VERIFY.md` — tuning them is a real-phone task, not a desk task.
 *
 * Hard caps (frame count, byte ceiling) are NOT redefined here. They belong to
 * the frozen contract in `lib/capture/types.ts` (`CAPTURE_LIMITS`) and are
 * imported wherever they are needed.
 */

export const CAPTURE_TUNING = {
  /**
   * Both gates must pass before a frame is kept: at least this much time AND at
   * least `minDisplacementM` of ground covered. Time alone would fill the
   * session with frames of a stopped phone; distance alone would fire wildly
   * when GPS jitters.
   */
  minIntervalMs: 1_000,
  /** Metres of GPS displacement required since the last KEPT frame. */
  minDisplacementM: 6,

  /**
   * Mean absolute difference (0..255) between consecutive 32x32 gray frames.
   * Below this the frame is treated as a redelivery of the previous one and
   * dropped. Guards the iOS behaviour where a hidden video keeps handing back
   * its last frame, and plain standing still.
   */
  duplicateDelta: 2,

  /**
   * Variance of the Laplacian over the 32x32 gray frame. Below this the frame is
   * called blurry and dropped. UNCALIBRATED — see the file header.
   */
  blurVariance: 40,

  /** Edge of the square gray thumbnail used for both dedupe and blur. */
  graySize: 32,

  /** GPS fixes at or above this accuracy are dropped server-side, so we warn. */
  accuracyWarnM: 25,

  /** JPEG encode settings. Longest side is clamped, aspect ratio preserved. */
  jpegQuality: 0.7,
  maxLongestSide: 1_024,

  /** A session auto-stops at this age even if the frame cap is not reached. */
  maxDurationMs: 30 * 60 * 1_000,
} as const;

export type CaptureTuning = typeof CAPTURE_TUNING;
