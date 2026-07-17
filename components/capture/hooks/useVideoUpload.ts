"use client";

/**
 * The uploaded-video state machine.
 *
 * The sibling of `useRecorder`, for the contributor who already walked the
 * street and has the video on their phone. It holds the same shape of promise:
 * everything the screens render is a state here, so the honest outcomes (this
 * browser cannot decode it, the extraction was killed and resumed, the route is
 * a guess, the upload backend is not live) are states rather than toasts.
 *
 * The order of the steps is forced by physics, not by taste:
 *
 *   pick the file -> extract the frames -> supply the route -> review -> upload
 *
 * The route CANNOT come first, and it cannot be inferred. Phone videos do not
 * carry GPS tracks. iPhones and Androids write at most a single start fix into
 * the container, and browsers strip even that on file input, so there is nothing
 * to read. This is the one thing about this flow that must never be softened in
 * the UI: we are not "detecting" the route and failing sometimes, we never had
 * it. The contributor supplies it, every time, and the honest thing is to ask.
 *
 * Two decoders, one artifact. WebCodecs is the fast path; a browser that will
 * not configure a decoder for this track gets the `<video>` seek loop instead.
 * Both encode through `frame-encode.ts` and both plan through `video-plan.ts`,
 * so which one ran is invisible downstream and is not recorded anywhere: it is
 * a property of the browser, not of the evidence.
 *
 * Extraction is checkpointed to OPFS after every frame. Decoding twenty minutes
 * of video is minutes of work, and a tab killed at frame 380 of 400 must not
 * start over. `framesExtracted` is the resume cursor and it only ever moves
 * forward.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUploadError,
  uploadCapture,
  type UploadProgress,
} from "@/lib/capture/upload-client";
import type { TrackPoint } from "@/lib/capture/types";
import { openCaptureStore, isQuotaError, type CaptureStore } from "@/components/capture/engine/opfs";
import { probeVideo, type VideoTrackInfo } from "@/components/capture/engine/video-demux";
import {
  canDecodeWithWebCodecs,
  extractFramesWithWebCodecs,
  VideoExtractError,
  type ExtractedFrame,
  type ExtractionProgress,
} from "@/components/capture/engine/video-extract";
import {
  extractFramesWithSeek,
  probeVideoElement,
} from "@/components/capture/engine/video-seek";
import { planExtraction, type ExtractionPlan } from "@/components/capture/engine/video-plan";
import {
  appendVideoFrame,
  createVideoManifest,
  deriveVideoStartMs,
  isVideoSessionManifest,
  setVideoRoute,
  setVideoStart,
  videoFrameMeta,
  type VideoRoute,
  type VideoSessionManifest,
} from "@/components/capture/engine/video-session";

export type VideoPhase =
  | "idle"
  | "probing"
  | "extracting"
  | "route"
  | "review"
  | "uploading"
  | "done";

/** Which decoder actually ran. Diagnostic only; it never reaches the server. */
export type DecodePath = "webcodecs" | "seek";

export type VideoUploadFailureKind =
  | "backend_not_live"
  | "storage_not_configured"
  | "offline"
  | "rate_limited"
  | "rejected"
  | "unknown";

export type VideoUploadFailure = { kind: VideoUploadFailureKind; detail: string };

/**
 * Why extraction could not happen. These are the `reason` strings the engine
 * throws, surfaced verbatim so the UI can say something specific rather than
 * "something went wrong".
 */
export type VideoError = { reason: string; detail?: string };

export type VideoUploadState = {
  phase: VideoPhase;
  file: File | null;
  plan: ExtractionPlan | null;
  decodePath: DecodePath | null;
  progress: ExtractionProgress | null;
  framesKept: number;
  /** The route as supplied, or null until the contributor gives us one. */
  route: VideoRoute | null;
  track: readonly TrackPoint[];
  /**
   * The clock correction, ms. Only ever non-zero on a timed-GPX route: nothing
   * else has a clock of its own for the video to disagree with.
   */
  clockOffsetMs: number;
  /** True when the route carries real times, i.e. when nudging the clock does anything. */
  clockNudgeMatters: boolean;
  error: VideoError | null;
  storageFull: boolean;
  durable: boolean;
  uploadProgress: UploadProgress | null;
  uploadFailure: VideoUploadFailure | null;
  sessionId: string | null;
};

/** Mirrors `useRecorder.classifyUploadError`: same funnel, same honest states. */
function classifyUploadError(error: unknown): VideoUploadFailure {
  if (error instanceof CaptureUploadError) {
    if (error.status === 501) return { kind: "backend_not_live", detail: error.message };
    if (error.status === 0 && error.endpoint === "storage") {
      return { kind: "storage_not_configured", detail: error.message };
    }
    if (error.status === 429) return { kind: "rate_limited", detail: error.message };
    if (error.status >= 400 && error.status < 500) {
      return { kind: "rejected", detail: error.message };
    }
    return { kind: "unknown", detail: error.message };
  }
  if (error instanceof TypeError) return { kind: "offline", detail: error.message };
  return { kind: "unknown", detail: error instanceof Error ? error.message : String(error) };
}

function localId(): string {
  return `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useVideoUpload() {
  const [phase, setPhase] = useState<VideoPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ExtractionPlan | null>(null);
  const [decodePath, setDecodePath] = useState<DecodePath | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [framesKept, setFramesKept] = useState(0);
  const [route, setRoute] = useState<VideoRoute | null>(null);
  const [track, setTrack] = useState<readonly TrackPoint[]>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [error, setError] = useState<VideoError | null>(null);
  const [storageFull, setStorageFull] = useState(false);
  const [durable, setDurable] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadFailure, setUploadFailure] = useState<VideoUploadFailure | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const storeRef = useRef<CaptureStore | null>(null);
  // The manifest lives in a ref for the same reason the recorder's does: it is
  // rewritten after every one of up to 400 frames, and putting it in state would
  // re-render the progress screen on every checkpoint for no visual gain.
  const manifestRef = useRef<VideoSessionManifest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await openCaptureStore();
      if (cancelled) return;
      storeRef.current = store;
      setDurable(store.durable);
    })();
    return () => {
      cancelled = true;
      // A pick that is still decoding when the page goes away must stop, or the
      // decoder keeps working against a manifest nobody will ever read.
      abortRef.current?.abort();
    };
  }, []);

  const publish = useCallback((manifest: VideoSessionManifest) => {
    manifestRef.current = manifest;
    setTrack(manifest.track);
    setRoute(manifest.video.route);
    setClockOffsetMs(manifest.video.clockOffsetMs);
  }, []);

  /**
   * Decide how to read this file, and get its duration.
   *
   * mp4box first, because when it works it also tells us whether WebCodecs can
   * take the track. When it cannot parse the container at all (a webm, a stream
   * the demuxer does not know) that is not a failure: the element can very
   * likely still play it, so we ask the element instead and take the seek path.
   */
  const probe = useCallback(
    async (
      source: File,
      signal: AbortSignal,
    ): Promise<{ plan: ExtractionPlan; path: DecodePath; info: VideoTrackInfo | null }> => {
      let info: VideoTrackInfo | null = null;
      try {
        info = await probeVideo(source, signal);
      } catch {
        info = null;
      }

      if (info && (await canDecodeWithWebCodecs(info))) {
        return { plan: planExtraction(info.durationMs), path: "webcodecs", info };
      }

      const durationMs =
        info && Number.isFinite(info.durationMs) && info.durationMs > 0
          ? info.durationMs
          : (await probeVideoElement(source, signal)).durationMs;

      return { plan: planExtraction(durationMs), path: "seek", info };
    },
    [],
  );

  const pickFile = useCallback(
    async (picked: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      setError(null);
      setUploadFailure(null);
      setStorageFull(false);
      setFramesKept(0);
      setProgress(null);
      setFile(picked);
      setPhase("probing");

      const store = storeRef.current ?? (await openCaptureStore());
      storeRef.current = store;
      setDurable(store.durable);

      try {
        const probed = await probe(picked, signal);
        if (signal.aborted) return;

        setPlan(probed.plan);
        setDecodePath(probed.path);

        if (probed.plan.targetFrames === 0) {
          setError({ reason: "video_too_short" });
          setPhase("idle");
          return;
        }

        const source = {
          name: picked.name,
          size: picked.size,
          lastModified: picked.lastModified,
        };
        let manifest = createVideoManifest({
          localId: localId(),
          startedAt: Date.now(),
          file: source,
          plan: probed.plan,
          videoStartMs: deriveVideoStartMs(source, probed.plan),
        });
        publish(manifest);
        await store.putManifest(manifest);

        setPhase("extracting");

        /**
         * Write the bytes FIRST, then record the frame.
         *
         * Same ordering rule as the recorder: a manifest entry for a frame whose
         * bytes never landed would survive a reload and then resume into a frame
         * that does not exist. Bytes, then meta, then checkpoint.
         */
        const onFrame = async (frame: ExtractedFrame) => {
          const current = manifestRef.current;
          if (!current) return;
          try {
            await store.putFrame(current.localId, frame.seq, frame.blob);
          } catch (err) {
            if (isQuotaError(err)) {
              setStorageFull(true);
              controller.abort();
              return;
            }
            throw err;
          }
          const next = appendVideoFrame(
            current,
            videoFrameMeta(current.localId, current.video.videoStartMs, frame),
          );
          publish(next);
          await store.putManifest(next);
          setFramesKept(next.frames.length);
        };

        const opts = {
          onFrame,
          onProgress: setProgress,
          signal,
          resumeFromSeq: manifest.video.framesExtracted,
        };

        if (probed.path === "webcodecs") {
          try {
            await extractFramesWithWebCodecs(picked, opts);
          } catch (err) {
            // `unsupported` can still surface here: `isConfigSupported` says yes
            // and then `configure` throws on the real stream. Falling back is
            // the whole point of having two paths.
            if (err instanceof VideoExtractError && err.reason === "unsupported") {
              setDecodePath("seek");
              await extractFramesWithSeek(picked, opts);
            } else {
              throw err;
            }
          }
        } else {
          await extractFramesWithSeek(picked, opts);
        }

        if (signal.aborted) return;

        manifest = manifestRef.current ?? manifest;
        if (manifest.frames.length === 0) {
          setError({ reason: "no_frames_extracted" });
          setPhase("idle");
          return;
        }

        setPhase("route");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof VideoExtractError
            ? { reason: err.reason, detail: err.message }
            : { reason: "extract_failed", detail: err instanceof Error ? err.message : String(err) },
        );
        setPhase("idle");
      }
    },
    [probe, publish],
  );

  /** Attach the route the contributor supplied, and move to review. */
  const applyRoute = useCallback(
    async (next: VideoRoute) => {
      const current = manifestRef.current;
      if (!current) return;
      const updated = setVideoRoute(current, next);
      publish(updated);
      await storeRef.current?.putManifest(updated);
      setPhase("review");
    },
    [publish],
  );

  /**
   * Move the video's start by `offsetMs` from the file's own guess.
   *
   * A no-op on any route without its own clock, and the UI should not offer it
   * there. See `setVideoStart` for why.
   */
  const nudgeClock = useCallback(
    async (offsetMs: number) => {
      const current = manifestRef.current;
      if (!current) return;
      const derived = current.video.videoStartMs - current.video.clockOffsetMs;
      const updated = setVideoStart(current, derived + offsetMs);
      publish(updated);
      await storeRef.current?.putManifest(updated);
    },
    [publish],
  );

  const upload = useCallback(
    async (contact?: string) => {
      const store = storeRef.current;
      const manifest = manifestRef.current;
      if (!store || !manifest || !manifest.video.route) return;

      setUploadFailure(null);
      setPhase("uploading");

      try {
        const frames = await store.loadFrames(manifest);
        const result = await uploadCapture({
          mode: "video",
          frames,
          track: manifest.track,
          source: manifest.video.route.source,
          clockOffsetMs: manifest.video.clockOffsetMs,
          // Resume rather than open a second session if this is a retry.
          ...(manifest.serverSessionId ? { sessionId: manifest.serverSessionId } : {}),
          ...(contact ? { contact } : {}),
          onProgress: (p) => {
            setUploadProgress(p);
            // Stash the server's id as soon as it exists: a retry after a failed
            // frame must resume that session, not open a new one and orphan the
            // frames already in storage.
            if (p.sessionId && manifestRef.current?.serverSessionId !== p.sessionId) {
              const withId = { ...manifestRef.current!, serverSessionId: p.sessionId };
              manifestRef.current = withId;
              void store.putManifest(withId);
            }
          },
        });

        const done: VideoSessionManifest = {
          ...manifestRef.current!,
          serverSessionId: result.sessionId,
          phase: "uploaded",
        };
        manifestRef.current = done;
        await store.putManifest(done);

        setSessionId(result.sessionId);
        setPhase("done");
      } catch (err) {
        setUploadFailure(classifyUploadError(err));
        setPhase("review");
      }
    },
    [],
  );

  /** Throw the whole session away, frames included. */
  const discard = useCallback(async () => {
    abortRef.current?.abort();
    const manifest = manifestRef.current;
    if (manifest) await storeRef.current?.discard(manifest.localId);
    manifestRef.current = null;

    setPhase("idle");
    setFile(null);
    setPlan(null);
    setDecodePath(null);
    setProgress(null);
    setFramesKept(0);
    setRoute(null);
    setTrack([]);
    setClockOffsetMs(0);
    setError(null);
    setStorageFull(false);
    setUploadProgress(null);
    setUploadFailure(null);
    setSessionId(null);
  }, []);

  const state: VideoUploadState = {
    phase,
    file,
    plan,
    decodePath,
    progress,
    framesKept,
    route,
    track,
    clockOffsetMs,
    clockNudgeMatters: route?.timedTrack !== undefined,
    error,
    storageFull,
    durable,
    uploadProgress,
    uploadFailure,
    sessionId,
  };

  return { ...state, pickFile, applyRoute, nudgeClock, upload, discard };
}

/** Re-exported so the screens can narrow a recovered manifest without reaching into the engine. */
export { isVideoSessionManifest };
