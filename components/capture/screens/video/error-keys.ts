"use client";

/**
 * Turning an engine `reason` string into a message key that is guaranteed to
 * exist.
 *
 * WHY THIS IS NOT INLINE. The repo's idiom for a machine reason is to
 * interpolate it straight into the key: `t(\`camera.${camera.reason}_title\`)`
 * in `StartScreen`. That works there because `CameraState.reason` is a closed
 * union, so the template resolves to a union of literal keys and the compiler
 * checks every one of them against `messages/en.json`. It does NOT work here.
 * `VideoError.reason` is typed `string`, deliberately: it is whatever the
 * decoder threw, and the engine reserves the right to throw a reason this file
 * has never heard of. A raw interpolation would not typecheck, and forcing it
 * through with a cast would trade a compile error for a runtime one, since a
 * missing key makes next-intl throw rather than degrade.
 *
 * So this is the narrowing seam. The reasons we have written copy for are listed
 * here, an unrecognised reason falls back to the generic pair, and the return is
 * a literal key type the compiler still checks. The list is the contract: adding
 * a reason to the engine without adding copy here means the contributor sees the
 * generic message, which is worse than a specific one and much better than a
 * white screen.
 *
 * The fallback copy is written to be true of any reason, known or not. It says
 * the file could not be read and offers the two ways forward that always exist
 * (a different export, or the live recorder). It never guesses at a cause.
 */

/**
 * Extraction reasons with copy of their own. Mirrors what the engine throws
 * (`video-extract.ts`, `video-seek.ts`, `video-demux.ts`) plus the two the hook
 * raises itself (`video_too_short`, `no_frames_extracted`).
 */
export const VIDEO_ERROR_REASONS = [
  "video_too_short",
  "no_frames_extracted",
  "extract_failed",
  "no_canvas",
  "no_video_element",
  "video_load_failed",
  "video_load_failed_timeout",
  "unknown_duration",
  "seek_failed",
  "seek_failed_timeout",
  "seek_stuck",
  "unsupported",
  "parse_failed",
  "no_moov",
  "no_video_track",
  "unknown",
] as const;

type VideoErrorReason = (typeof VIDEO_ERROR_REASONS)[number];

/** Reasons `parseGpx` returns. See `lib/capture/gpx.ts`. */
export const GPX_ERROR_REASONS = [
  "not_gpx",
  "no_trackpoints",
  "malformed_coordinates",
  "unterminated_trackpoint",
  "unknown",
] as const;

type GpxErrorReason = (typeof GPX_ERROR_REASONS)[number];

function narrow<T extends string>(known: readonly T[], reason: string, fallback: T): T {
  return (known as readonly string[]).includes(reason) ? (reason as T) : fallback;
}

/** The title/body key pair for an extraction failure, or null when there is none. */
export function videoErrorKeys(
  reason: string | undefined,
): { title: `videoError.${VideoErrorReason}_title`; body: `videoError.${VideoErrorReason}_body` } | null {
  if (reason === undefined) return null;
  const known = narrow(VIDEO_ERROR_REASONS, reason, "unknown");
  return { title: `videoError.${known}_title`, body: `videoError.${known}_body` };
}

/** The title/body key pair for a GPX that would not parse. */
export function gpxErrorKeys(reason: string): {
  title: `gpxError.${GpxErrorReason}_title`;
  body: `gpxError.${GpxErrorReason}_body`;
} {
  const known = narrow(GPX_ERROR_REASONS, reason, "unknown");
  return { title: `gpxError.${known}_title`, body: `gpxError.${known}_body` };
}
