/**
 * The pure video arithmetic: how densely to sample, at which offsets, and which
 * way is up.
 *
 * This is a separate module from `video-extract.ts` and `video-demux.ts` for one
 * concrete reason: testability. Both of those import mp4box, which is ESM-only,
 * and the repo's test harness compiles TypeScript to CommonJS and `require()`s
 * the result. A `require()` through an ESM-only package throws, so any pure
 * function sharing a file with that import is untestable in the harness we
 * actually have.
 *
 * What lives here is what is worth pinning, and both earn it by failing quietly
 * rather than loudly. The sampling decision is arithmetic with a hard cap that
 * silently decides how much of a street gets covered. The rotation read decides
 * which way every frame faces, and a wrong answer produces a complete,
 * correct-looking set of sideways JPEGs.
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

/* ------------------------------------------------------------------ *
 * Which way is up
 * ------------------------------------------------------------------ */

/** Clockwise display rotation, the only four values a camera ever writes. */
export type FrameRotation = 0 | 90 | 180 | 270;

/**
 * Read the clockwise display rotation out of a track's transform matrix.
 *
 * This exists because a phone does not rotate the pixels it records. It writes
 * the sensor's native landscape frame plus a matrix saying "turn this 90 degrees
 * to show it", so a portrait POV walk is a LANDSCAPE stream and an instruction.
 * A `<video>` element honours that instruction for free. A raw `VideoDecoder`
 * never sees it, because we demux the container ourselves, so without this the
 * WebCodecs path would ship sideways frames while the seek path shipped upright
 * ones for the same video.
 *
 * The tkhd matrix is `[a, b, u, c, d, v, x, y, w]` (ISO 14496-12). Rotation lives
 * in the `a`/`b` pair, and `atan2(b, a)` recovers it without caring that the
 * values are 16.16 fixed point, because the scale cancels.
 *
 * Snapped to the four right angles, and anything else is treated as no rotation.
 * A camera only ever writes a right angle, so an off-axis result means the matrix
 * is corrupt or exotic. Rounding that into the nearest quarter turn would rotate
 * every frame of the walk on the strength of a value we already know we do not
 * understand, and doing nothing is the same thing an element does with a matrix
 * it cannot make sense of.
 */
export function readRotation(
  matrix: ArrayLike<number> | undefined | null,
): FrameRotation {
  if (!matrix || matrix.length < 2) return 0;

  const a = Number(matrix[0]);
  const b = Number(matrix[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  // The identity of "no information": atan2(0, 0) is 0, which would read as an
  // upright frame rather than as the absent matrix it actually is.
  if (a === 0 && b === 0) return 0;

  const degrees = (Math.round((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
  return degrees === 90 || degrees === 180 || degrees === 270 ? degrees : 0;
}
