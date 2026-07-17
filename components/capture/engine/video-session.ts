/**
 * The on-device manifest for the uploaded-video path, and its extraction
 * checkpoint.
 *
 * This is `session.ts`'s twin for a video someone already shot. A live walk
 * loses one frame when the tab dies, because every kept frame hits OPFS the
 * instant it exists. Extraction has the same failure and a much worse cost:
 * decoding twenty minutes of H.264 on a phone is minutes of work, and dying at
 * frame 380 of 400 must not mean starting at zero. So the same discipline
 * applies. Each extracted frame is written, the manifest is rewritten behind it,
 * and `video.framesExtracted` is the cursor `extractFramesWithWebCodecs` reads
 * back as `resumeFromSeq`. A killed tab resumes; it does not restart.
 *
 * `localId` means here exactly what it means for a walk: the intake starts
 * before the server knows anything about it, the real `sessionId` only arrives
 * from `createSession` at upload time, and frames are therefore staged under the
 * local id. `uploadCapture` rewrites the storage path from the server's id, so
 * nothing written here can forge one.
 *
 * ## Why this rides on `SessionManifest` instead of being its own thing
 *
 * `CaptureStore` (see `opfs.ts`) is typed against the live `SessionManifest`:
 * `putManifest`, `listManifests` and `loadFrames` all speak it. A video session
 * needs to persist different facts (the source file, the extraction plan, the
 * resume cursor, the drawn or uploaded route, the clock nudge) and has no use
 * for others (there are no GPS drops to count, and there are no
 * backgrounding sub-segments because nobody is holding a camera).
 *
 * Three ways to square that. A parallel store would mean a second OPFS path, a
 * second write queue and a second quota story, for the same bytes. A parallel
 * `VideoStore` interface would duplicate `opfs.ts` wholesale. What this file
 * does instead is make `VideoSessionManifest` a structural SUPERSET of
 * `SessionManifest`: the live fields are all present and all truthfully filled
 * (a video is genuinely one contiguous segment, and it genuinely drops nothing
 * through a GPS gate), and everything video-specific hangs off one `video`
 * member. The existing store then works untouched, including its write queue,
 * its quota handling and its frame rehydration. The cost is three fields carried
 * for shape rather than for meaning; the alternative was a second copy of a file
 * whose comments explain why it is hard.
 *
 * ## The cross-contamination hazard, stated out loud
 *
 * Because the shape is a superset, `isSessionManifest` accepts a video manifest,
 * so `listManifests()` returns it to the live recorder, which offers anything
 * `isRecoverable` to the user as a walk to resume. That would be a real bug: a
 * half-extracted video would be presented as an interrupted walk and recovered
 * into a recorder that has no idea what to do with it. `video` is the
 * discriminant that makes the two tellable apart, and `isVideoSessionManifest`
 * is how you tell. It is a field the live recorder cannot produce (nothing in
 * `createManifest` writes it), so the test is exact in both directions. The live
 * recovery path must filter on it. That filter is one line and it lives on the
 * live side, in `useRecorder`.
 *
 * ## Versioning
 *
 * `video.version` is separate from the live `MANIFEST_VERSION` on purpose: the
 * envelope is the live manifest's contract and the inner record is ours, and the
 * two change for different reasons. Bumping it invalidates recovered video
 * sessions rather than migrating them, for the same reason the live one does. A
 * stale half-extraction is not worth a migration path.
 */

import {
  MANIFEST_VERSION,
  isSessionManifest,
  type SessionManifest,
} from "@/components/capture/engine/session";
import { emptyDropCounts } from "@/components/capture/engine/gating";
import type {
  ExtractedFrame,
  ExtractionPlan,
} from "@/components/capture/engine/video-extract";
import {
  captureFrameStoragePath,
  type CaptureFrameMeta,
  type TrackPoint,
} from "@/lib/capture/types";
import { distributeTimesAlongPath, type LatLng } from "@/lib/capture/route";

export const VIDEO_MANIFEST_VERSION = 1 as const;

/**
 * Where a video session's route came from.
 *
 * `TrackSource` minus "live", and not a re-alias of it: "live" is exactly the
 * value this path can never produce, and a type that cannot express it is better
 * than a comment saying so. The two values map straight onto `TrackSource` when
 * the session finalizes.
 */
export type VideoRouteSource = "gpx" | "trace";

/**
 * What we know about the file the frames came out of.
 *
 * Kept because it is the only way to recognise a resumed extraction as being the
 * same video. OPFS holds our frames but not the source (a multi-gigabyte file has
 * no business being copied into origin storage), so on resume the contributor
 * must re-pick the file and we have to be able to say "that is not the one" out
 * loud rather than silently splicing two videos into one session.
 */
export type VideoSourceFile = {
  name: string;
  size: number;
  /** The file's own mtime, epoch ms. Also the seed for `videoStartMs`. */
  lastModified: number;
};

/** A route drawn on the map or read out of a GPX, before it is timed. */
export type VideoRoute = {
  source: VideoRouteSource;
  path: LatLng[];
};

/** The video-specific half of the manifest. The live half is `SessionManifest`. */
export type VideoSessionInfo = {
  version: typeof VIDEO_MANIFEST_VERSION;
  file: VideoSourceFile;
  plan: ExtractionPlan;
  /**
   * Epoch ms of the video's first frame: what `offsetMs` is measured from.
   *
   * Derived from the file's mtime (a camera writes the file when recording
   * stops, so the start is mtime minus duration) and then nudged by the
   * contributor when that guess is wrong, which it often is. This is the
   * effective value, already nudged. Frame times and the route's timestamps are
   * both computed from it, which is why moving it has to go through
   * `setVideoStart` rather than being assigned.
   */
  videoStartMs: number;
  /**
   * How far the contributor moved the clock from the derived guess.
   *
   * Mirrors `capture_sessions.clock_offset_ms`: the correction is recorded, the
   * fixes are not mutated behind it. The derived guess is recoverable as
   * `videoStartMs - clockOffsetMs`, so it does not need its own field, and
   * keeping one number instead of two means they cannot disagree.
   */
  clockOffsetMs: number;
  /**
   * The resume cursor: the next `seq` extraction should attempt.
   *
   * NOT `frames.length`. A frame can be planned and then not kept (the encode
   * fails, or the JPEG lands over `maxFrameBytes`), so seq numbers have holes and
   * counting the survivors would rewind the cursor onto ground already covered.
   * This only ever moves forward, past the highest seq we have decided about.
   */
  framesExtracted: number;
  /** Null until the contributor draws a line or uploads a GPX. */
  route: VideoRoute | null;
};

/**
 * A video session as it lives on disk.
 *
 * Assignable to `SessionManifest`, which is the entire point: `putManifest`
 * takes it as-is. Read the file header before changing that.
 *
 * The inherited fields mean what they mean on the live side, with two worth
 * spelling out. `startedAt` is when the contributor picked the file, NOT when
 * the video was shot (that is `video.videoStartMs`); it is what `listManifests`
 * sorts on, so it has to be intake time for the ordering to make sense. `phase`
 * stays the live `SessionPhase` because the extra states a video path seems to
 * want ("extracting", "waiting for a route") are already derivable and a second
 * source of truth for one fact is a bug waiting to happen: extraction is
 * unfinished exactly when `isResumableExtraction` says so, and the route is
 * missing exactly when `video.route` is null.
 */
export type VideoSessionManifest = SessionManifest & {
  video: VideoSessionInfo;
};

/**
 * Seed a video session from the picked file and the plan.
 *
 * `startedAt` is passed in rather than read off the clock so the caller owns the
 * one timestamp the whole session sorts by; everything in here stays pure.
 *
 * The live fields are filled honestly rather than stubbed. `segments` is one
 * segment covering the intake because a video IS one contiguous stretch of
 * recording (that is what makes it a video). `dropCounts` is empty because
 * `engine/gating.ts` never runs on this path, and its counters start at zero
 * whether or not anything will ever increment them.
 */
export function createVideoManifest(args: {
  localId: string;
  startedAt: number;
  file: VideoSourceFile;
  plan: ExtractionPlan;
  videoStartMs: number;
}): VideoSessionManifest {
  return {
    version: MANIFEST_VERSION,
    localId: args.localId,
    serverSessionId: null,
    startedAt: args.startedAt,
    endedAt: null,
    phase: "recording",
    frames: [],
    track: [],
    segments: [{ index: 0, startedAt: args.startedAt, endedAt: null }],
    dropCounts: emptyDropCounts(),
    contact: null,
    video: {
      version: VIDEO_MANIFEST_VERSION,
      file: args.file,
      plan: args.plan,
      videoStartMs: args.videoStartMs,
      clockOffsetMs: 0,
      framesExtracted: 0,
      route: null,
    },
  };
}

/**
 * The best guess at when a video started, from the file alone.
 *
 * A camera writes the file out when recording stops, so mtime is the END. This
 * is a guess and it is wrong often enough that the nudge UI exists: some
 * pipelines rewrite mtime on export, some transfers stamp it with the copy time.
 * It is still a far better starting point than "now", which would be wrong by
 * however long the file sat on the contributor's phone.
 */
export function deriveVideoStartMs(file: VideoSourceFile, plan: ExtractionPlan): number {
  return file.lastModified - plan.durationMs;
}

/**
 * The `CaptureFrameMeta` for an extracted frame.
 *
 * The two things this exists to get right, both of which are silent when wrong:
 * `offsetMs` is measured from the start of the video and `t` must be epoch, so
 * the clock is added here and nowhere else; and the path is staged under the
 * LOCAL id via `captureFrameStoragePath`, identical to the live recorder, so
 * `uploadCapture` rewrites it from the real session id at upload time.
 *
 * `blurScore` is omitted rather than passed through when it is not a finite
 * number. The field is optional precisely so a missing score never blocks an
 * upload, and a NaN would serialize to `null` through OPFS and fail validation
 * later, a long way from here.
 */
export function videoFrameMeta(
  localId: string,
  videoStartMs: number,
  frame: ExtractedFrame,
): CaptureFrameMeta {
  const meta: CaptureFrameMeta = {
    seq: frame.seq,
    t: videoStartMs + frame.offsetMs,
    storagePath: captureFrameStoragePath(localId, frame.seq),
    width: frame.width,
    height: frame.height,
    bytes: frame.blob.size,
  };
  if (Number.isFinite(frame.blurScore)) meta.blurScore = frame.blurScore;
  return meta;
}

/**
 * Record a kept frame and advance the cursor.
 *
 * The cursor moves to `seq + 1`, never backwards, so a resumed run that re-walks
 * ground it already covered cannot un-checkpoint it. Re-adding the same seq
 * replaces the entry rather than duplicating it: registration is idempotent on
 * seq on the wire, and it should be idempotent here too, or a resume that
 * overlaps by one frame would upload that frame twice.
 */
export function appendVideoFrame(
  manifest: VideoSessionManifest,
  meta: CaptureFrameMeta,
): VideoSessionManifest {
  const frames = manifest.frames.filter((existing) => existing.seq !== meta.seq);
  frames.push(meta);
  frames.sort((a, b) => a.seq - b.seq);
  return {
    ...manifest,
    frames,
    video: {
      ...manifest.video,
      framesExtracted: Math.max(manifest.video.framesExtracted, meta.seq + 1),
    },
  };
}

/**
 * Recompute the track from the route and the video's clock.
 *
 * The inversion `lib/capture/route.ts` exists for: the route's VERTICES get
 * timestamps, and every frame then places itself through the same
 * `interpolateAt` a live GPS track uses. So there is nothing to do per frame
 * here, and the track is a pure function of (route, videoStartMs, duration).
 * Any change to those three funnels through this one call.
 *
 * The route is timed across the video's full span rather than across the frames
 * we happened to keep. The contributor walked the whole line, including the
 * seconds either side of the first and last sample, and pinning the ends to
 * frame times would quietly shorten the route by up to an interval at each end.
 */
function retimeTrack(manifest: VideoSessionManifest): VideoSessionManifest {
  const { videoStartMs, plan, route } = manifest.video;
  const track: TrackPoint[] = route
    ? distributeTimesAlongPath(route.path, videoStartMs, videoStartMs + plan.durationMs)
    : [];
  return { ...manifest, track };
}

/**
 * Move the video's start, re-deriving frame times and the route's clock.
 *
 * `clockOffsetMs` is updated against the ORIGINAL derived guess, not against the
 * previous nudge, so dragging the slider around does not accumulate: the offset
 * always reads as the total correction from what the file claimed, which is the
 * number the server stores and the number a reviewer would want to see.
 */
export function setVideoStart(
  manifest: VideoSessionManifest,
  videoStartMs: number,
): VideoSessionManifest {
  const derived = manifest.video.videoStartMs - manifest.video.clockOffsetMs;
  const shifted: VideoSessionManifest = {
    ...manifest,
    frames: manifest.frames.map((meta) => ({
      ...meta,
      t: meta.t + (videoStartMs - manifest.video.videoStartMs),
    })),
    video: {
      ...manifest.video,
      videoStartMs,
      clockOffsetMs: videoStartMs - derived,
    },
  };
  return retimeTrack(shifted);
}

/**
 * Attach (or clear) the route, and time it against the video.
 *
 * The path is copied rather than kept by reference. It arrives from a map editor
 * that is still mutating its own array, and a manifest that changes under OPFS
 * between the `JSON.stringify` and the write is the kind of bug that only shows
 * up on a slow disk.
 */
export function setVideoRoute(
  manifest: VideoSessionManifest,
  route: VideoRoute | null,
): VideoSessionManifest {
  const copied: VideoRoute | null = route
    ? { source: route.source, path: route.path.map((p) => ({ lat: p.lat, lng: p.lng })) }
    : null;
  return retimeTrack({ ...manifest, video: { ...manifest.video, route: copied } });
}

/**
 * True when there is still video left to decode.
 *
 * Read `video.framesExtracted` straight into `ExtractOptions.resumeFromSeq` when
 * this says yes. Note the `>=`: a plan can produce fewer frames than it targeted
 * (a truncated file, a decoder giving up early) and the cursor running past the
 * target is a finished extraction, not a broken one.
 */
export function isResumableExtraction(manifest: VideoSessionManifest): boolean {
  if (manifest.phase === "uploaded") return false;
  return manifest.video.framesExtracted < manifest.video.plan.targetFrames;
}

/**
 * Worth offering back to the contributor.
 *
 * Deliberately looser than the live `isRecoverable`, which wants frames AND a
 * two-fix track before it will interrupt a walker. Here a session with frames and
 * no route at all is the normal mid-flight state (the route is drawn after
 * extraction, not during), and it is exactly the session worth resuming: those
 * frames cost minutes of decode. A session with no frames yet has cost nothing
 * and is debris to sweep, not a decision to put in front of anybody.
 */
export function isRecoverableVideoSession(manifest: VideoSessionManifest): boolean {
  if (manifest.phase === "uploaded") return false;
  return manifest.frames.length > 0 || isResumableExtraction(manifest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSourceFile(value: unknown): value is VideoSourceFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.lastModified === "number"
  );
}

function isExtractionPlan(value: unknown): value is ExtractionPlan {
  if (!isRecord(value)) return false;
  return (
    typeof value.durationMs === "number" &&
    typeof value.intervalMs === "number" &&
    typeof value.targetFrames === "number" &&
    typeof value.sparser === "boolean"
  );
}

function isRoute(value: unknown): value is VideoRoute {
  if (!isRecord(value)) return false;
  if (value.source !== "gpx" && value.source !== "trace") return false;
  if (!Array.isArray(value.path)) return false;
  return value.path.every(
    (p: unknown) => isRecord(p) && typeof p.lat === "number" && typeof p.lng === "number",
  );
}

/**
 * Structural check for a video manifest read back off disk, and the discriminant
 * that keeps the two recovery flows apart.
 *
 * Two jobs, and both matter. Like `isSessionManifest`, it is a shape guard so an
 * arbitrarily old file surfaces as "discard this" rather than a crash on load,
 * and it does not revalidate frames or track against the zod schemas (those run
 * at upload time, where a rejection can be reported honestly). Unlike it, this is
 * also the ONLY thing standing between a half-extracted video and the live
 * recorder's recovery prompt. It leads with `isSessionManifest` so a false here
 * cannot mean "not a manifest at all", then requires the `video` record that no
 * live session ever writes.
 *
 * The version check is deliberately inside, not alongside: an old video manifest
 * is still a VIDEO manifest, and answering "no" to that question would hand it to
 * the live recorder as a walk, which is worse than discarding it. It returns
 * false because it is not a manifest this build can use, and the live path
 * rejects it for the same reason (its own version gate), so it is swept by both.
 */
export function isVideoSessionManifest(value: unknown): value is VideoSessionManifest {
  if (!isSessionManifest(value)) return false;
  const video = (value as { video?: unknown }).video;
  if (!isRecord(video)) return false;
  if (video.version !== VIDEO_MANIFEST_VERSION) return false;
  if (!isSourceFile(video.file)) return false;
  if (!isExtractionPlan(video.plan)) return false;
  if (typeof video.videoStartMs !== "number") return false;
  if (typeof video.clockOffsetMs !== "number") return false;
  if (typeof video.framesExtracted !== "number") return false;
  if (video.route !== null && !isRoute(video.route)) return false;
  return true;
}

/**
 * True when a manifest off disk carries a `video` member at all.
 *
 * Separate from `isVideoSessionManifest` and not a duplicate of it. That guard
 * answers "can this build use this video session", and a stale one answers no.
 * This answers "was this ever a video session", which is the question the LIVE
 * recovery path needs: a video manifest this build cannot read is still not a
 * walk, and filtering on the strict guard would leak exactly the manifests that
 * failed it into the walk recovery prompt.
 */
export function looksLikeVideoSession(manifest: SessionManifest): boolean {
  return isRecord((manifest as { video?: unknown }).video);
}
