"use client";

/**
 * The recorder state machine.
 *
 * Holds the walk together: camera, GPS, wake lock and frame clock feed in here,
 * frames go out to OPFS and then to the upload client. Everything the screens
 * render is derived from this hook, so the honest states (denied, no signal,
 * storage full, backend not live) are states here, not toasts.
 *
 * Two structural choices worth knowing before reading:
 *
 * 1. The manifest lives in a ref, not in state. It is mutated up to 400 times
 *    per walk and written through to disk on every change; putting it in state
 *    would re-render the preview on every frame for no visual gain. What the UI
 *    needs is published separately as `stats`, at roughly 1 Hz.
 * 2. There is no "resume the same track" path after backgrounding. The camera
 *    was dead while the walker kept moving, so the frames either side are not
 *    continuous. Returning opens a NEW sub-segment and says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_LIMITS, captureFrameStoragePath, type CaptureFrameMeta, type TrackPoint } from "@/lib/capture/types";
import {
  CaptureUploadError,
  uploadCapture,
  type UploadProgress,
} from "@/lib/capture/upload-client";
import { fitDimensions, toGray } from "@/components/capture/engine/frame-analysis";
import { trackDistanceMeters } from "@/components/capture/engine/geo";
import {
  emptyDropCounts,
  evaluateFrame,
  sessionCapReached,
  type DropCounts,
  type DropReason,
  type GateMemory,
  type SessionCapReason,
} from "@/components/capture/engine/gating";
import { openCaptureStore, isQuotaError, type CaptureStore } from "@/components/capture/engine/opfs";
import {
  closeSegment,
  createManifest,
  isRecoverable,
  openSegment,
  type SessionManifest,
} from "@/components/capture/engine/session";
import { looksLikeVideoSession } from "@/components/capture/engine/video-session";
import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";
import {
  isCameraSupported,
  isSecureCameraContext,
  useCamera,
} from "@/components/capture/hooks/useCamera";
import { isGeolocationSupported, useGeolocation } from "@/components/capture/hooks/useGeolocation";
import { useFrameClock } from "@/components/capture/hooks/useFrameClock";
import { useWakeLock } from "@/components/capture/hooks/useWakeLock";

export type RecorderPhase =
  | "checking"
  | "unsupported"
  | "recover"
  | "idle"
  | "recording"
  | "paused"
  | "review"
  | "uploading"
  | "done";

/** Why the page cannot record at all on this device. */
export type UnsupportedReason = "insecure_context" | "no_camera_api" | "no_geolocation";

/**
 * Why an upload did not land.
 *
 * `backend_not_live` is the EXPECTED outcome today: the capture routes are 501
 * stubs until the ingest unit lands. It is a distinct state from a real failure
 * because the walker's frames are safe and the correct advice is "come back",
 * not "try again now".
 */
export type UploadFailureKind =
  | "backend_not_live"
  | "storage_not_configured"
  | "offline"
  | "rate_limited"
  | "rejected"
  | "unknown";

export type UploadFailure = { kind: UploadFailureKind; detail: string };

export type RecorderStats = {
  framesKept: number;
  dropCounts: DropCounts;
  distanceM: number;
  elapsedMs: number;
  accuracyM: number | null;
  trackPoints: number;
};

const emptyStats = (): RecorderStats => ({
  framesKept: 0,
  dropCounts: emptyDropCounts(),
  distanceM: 0,
  elapsedMs: 0,
  accuracyM: null,
  trackPoints: 0,
});

function initialPhase(): RecorderPhase {
  return isSecureCameraContext() && isCameraSupported() && isGeolocationSupported()
    ? "checking"
    : "unsupported";
}

function unsupportedReason(): UnsupportedReason | null {
  if (!isSecureCameraContext()) return "insecure_context";
  if (!isCameraSupported()) return "no_camera_api";
  if (!isGeolocationSupported()) return "no_geolocation";
  return null;
}

/** Map an upload throw onto something the UI can say plainly. */
function classifyUploadError(error: unknown): UploadFailure {
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
  // upload-client retries unclassified throws (offline, DNS) to exhaustion, so
  // reaching here with a TypeError means the network never came back.
  if (error instanceof TypeError) return { kind: "offline", detail: error.message };
  return { kind: "unknown", detail: error instanceof Error ? error.message : String(error) };
}

export function useRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>(initialPhase);
  const [stats, setStats] = useState<RecorderStats>(emptyStats);
  const [durable, setDurable] = useState(true);
  const [recoverable, setRecoverable] = useState<SessionManifest | null>(null);
  const [capReason, setCapReason] = useState<SessionCapReason | null>(null);
  const [storageFull, setStorageFull] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadFailure, setUploadFailure] = useState<UploadFailure | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Snapshotted at stop/recover rather than read from the manifest ref during
  // render: the review map only needs the finished track, and reading a ref in
  // render is exactly the tearing bug the compiler lint exists to catch.
  const [reviewTrack, setReviewTrack] = useState<readonly TrackPoint[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const grayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const jpegCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const storeRef = useRef<CaptureStore | null>(null);
  const manifestRef = useRef<SessionManifest | null>(null);
  const gateRef = useRef<GateMemory>({ lastKeptT: null, lastKeptPosition: null, prevGray: null });
  const latestFixRef = useRef<TrackPoint | null>(null);
  // Guards against a second frame entering the encode path while `toBlob` is
  // still resolving. Without it a slow phone stacks encodes and seq numbers race.
  const encodingRef = useRef(false);
  // Mirrored into a ref because the GPS callback is registered once and would
  // otherwise close over a stale phase. Synced in an effect, never during render
  // (same pattern as `useContribute.ts`).
  const phaseRef = useRef<RecorderPhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const { state: cameraState, start: startCamera, stop: stopCamera } = useCamera();
  const isRecording = phase === "recording";
  const wakeLock = useWakeLock(isRecording || phase === "paused");

  const onFix = useCallback((point: TrackPoint) => {
    latestFixRef.current = point;
    const manifest = manifestRef.current;
    if (!manifest || phaseRef.current !== "recording") return;
    manifest.track.push(point);
  }, []);

  const geo = useGeolocation({ enabled: isRecording || phase === "paused", onFix });

  /* ---------------------------------------------------------------- *
   * Boot: open the store, look for an unfinished walk
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (initialPhase() === "unsupported") return;
    let cancelled = false;

    void (async () => {
      const store = await openCaptureStore();
      if (cancelled) return;
      storeRef.current = store;

      // Video-upload sessions share this store and are a structural superset of
      // a walk's manifest, so they pass `isRecoverable` on their own merits.
      // Without this filter the recorder would offer to "recover" someone's
      // half-extracted video as an unfinished walk, and recovering it would put
      // a camera session on top of frames that never came from this camera.
      // `looksLikeVideoSession` and not `isVideoSessionManifest`: the strict
      // guard also checks the inner version, so a stale video manifest would
      // fail it and leak straight back into this prompt.
      const found =
        (await store.listManifests()).find(
          (manifest) => !looksLikeVideoSession(manifest) && isRecoverable(manifest),
        ) ?? null;
      if (cancelled) return;

      setDurable(store.durable);
      setRecoverable(found);
      setPhase(found ? "recover" : "idle");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------------------------------------------- *
   * Publishing stats to the UI
   * ---------------------------------------------------------------- */
  const publishStats = useCallback(() => {
    const manifest = manifestRef.current;
    if (!manifest) return;
    setStats({
      framesKept: manifest.frames.length,
      dropCounts: { ...manifest.dropCounts },
      distanceM: trackDistanceMeters(manifest.track),
      elapsedMs: Date.now() - manifest.startedAt,
      accuracyM: latestFixRef.current?.accuracy ?? null,
      trackPoints: manifest.track.length,
    });
  }, []);

  /**
   * The one way a walk ends.
   *
   * Every close-out path goes through here (the stop button, the frame cap, the
   * duration cap, a full disk), because each of them has to do the same four
   * things and it is the paths that skipped them that went wrong: close the open
   * segment and stamp the end, snapshot the track for the review map, RELEASE THE
   * CAMERA, and persist. A cap that ended the walk but left the camera live and
   * the manifest saying `phase: "recording"` is exactly the bug this collapses.
   */
  const finishSession = useCallback(() => {
    const manifest = manifestRef.current;
    if (manifest) {
      const at = Date.now();
      const closed = closeSegment(manifest, at);
      closed.endedAt = at;
      closed.phase = "ready_to_upload";
      manifestRef.current = closed;
      setReviewTrack([...closed.track]);
      void storeRef.current?.putManifest(closed).catch(() => undefined);
    }
    stopCamera();
    publishStats();
    setPhase("review");
  }, [publishStats, stopCamera]);

  // The elapsed clock and the drop tallies would otherwise only move when a
  // frame is kept, which on a stationary phone is never. A 1 Hz tick keeps the
  // HUD honest without re-rendering per video frame.
  //
  // The duration cap is enforced here rather than in the frame pipeline for the
  // same reason. It exists precisely for the walk where frames are NOT being
  // kept, so checking it only after a keep means a phone in a pocket drops every
  // frame, never reaches the check, and records forever with the wake lock held.
  useEffect(() => {
    if (phase !== "recording") return;

    const tick = () => {
      publishStats();
      const manifest = manifestRef.current;
      if (!manifest) return;
      const cap = sessionCapReached({
        frameCount: manifest.frames.length,
        startedAt: manifest.startedAt,
        now: Date.now(),
        maxFrames: CAPTURE_LIMITS.maxFrames,
      });
      if (cap) {
        setCapReason(cap);
        finishSession();
      }
    };

    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [phase, publishStats, finishSession]);

  /* ---------------------------------------------------------------- *
   * The frame pipeline
   * ---------------------------------------------------------------- */
  const grayFromVideo = useCallback((video: HTMLVideoElement): Uint8Array => {
    const size = CAPTURE_TUNING.graySize;
    const canvas = grayCanvasRef.current;
    if (!canvas) return new Uint8Array(size * size);
    canvas.width = size;
    canvas.height = size;
    // `willReadFrequently` matters: without it the browser keeps this canvas on
    // the GPU and every getImageData is a full readback stall.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return new Uint8Array(size * size);
    ctx.drawImage(video, 0, 0, size, size);
    return toGray(ctx.getImageData(0, 0, size, size).data);
  }, []);

  const encodeFrame = useCallback(
    async (video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number } | null> => {
      const canvas = jpegCanvasRef.current;
      if (!canvas) return null;

      const { width, height } = fitDimensions(
        video.videoWidth,
        video.videoHeight,
        CAPTURE_TUNING.maxLongestSide,
      );
      if (width === 0 || height === 0) return null;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", CAPTURE_TUNING.jpegQuality),
      );
      if (!blob) return null;
      return { blob, width, height };
    },
    [],
  );

  const tallyDrop = useCallback((reason: DropReason) => {
    const manifest = manifestRef.current;
    if (manifest) manifest.dropCounts[reason] += 1;
  }, []);

  const keepFrame = useCallback(
    async (video: HTMLVideoElement, now: number, fix: TrackPoint, blurScore: number) => {
      const manifest = manifestRef.current;
      const store = storeRef.current;
      if (!manifest || !store) return;

      const encoded = await encodeFrame(video);
      if (!encoded) return;

      // The byte ceiling is the bucket's, not ours (0013_capture.sql sets
      // file_size_limit to the same number). A frame over it would be rejected
      // at upload, so it is dropped here where we can still say why.
      if (encoded.blob.size > CAPTURE_LIMITS.maxFrameBytes) {
        tallyDrop("oversize");
        return;
      }

      const seq = manifest.frames.length;
      const meta: CaptureFrameMeta = {
        seq,
        t: now,
        // Staged under the LOCAL id: the real session id does not exist until
        // upload. `uploadCapture` rewrites this to the canonical path derived
        // from the server's id, so this value cannot forge a destination.
        storagePath: captureFrameStoragePath(manifest.localId, seq),
        width: encoded.width,
        height: encoded.height,
        bytes: encoded.blob.size,
        blurScore,
      };

      try {
        await store.putFrame(manifest.localId, seq, encoded.blob);
      } catch (error) {
        if (isQuotaError(error)) {
          // Out of room. Stop cleanly with what we have rather than spinning on
          // failing writes; the walk so far is still uploadable.
          setStorageFull(true);
          finishSession();
          return;
        }
        // Anything else: lose the frame, say so in the ledger, keep walking. A
        // single bad write is not a reason to end someone's walk, but it is a
        // reason the review screen must be able to name.
        tallyDrop("write_failed");
        return;
      }

      // Only recorded once the bytes are safely down. If the write failed we
      // must not claim the frame exists.
      manifest.frames.push(meta);
      gateRef.current = {
        ...gateRef.current,
        lastKeptT: now,
        lastKeptPosition: { lat: fix.lat, lng: fix.lng },
      };
      await store.putManifest(manifest);
      publishStats();

      const cap = sessionCapReached({
        frameCount: manifest.frames.length,
        startedAt: manifest.startedAt,
        now,
        maxFrames: CAPTURE_LIMITS.maxFrames,
      });
      if (cap) {
        setCapReason(cap);
        finishSession();
      }
    },
    [encodeFrame, finishSession, publishStats, tallyDrop],
  );

  const handleFrame = useCallback(
    (now: number) => {
      const video = videoRef.current;
      const manifest = manifestRef.current;
      if (!video || !manifest || encodingRef.current) return;

      const fix = latestFixRef.current;
      const verdict = evaluateFrame(
        {
          now,
          position: fix ? { lat: fix.lat, lng: fix.lng } : null,
          gray: () => grayFromVideo(video),
          graySize: CAPTURE_TUNING.graySize,
        },
        gateRef.current,
      );

      if (verdict.gray) gateRef.current = { ...gateRef.current, prevGray: verdict.gray };

      if (!verdict.keep) {
        tallyDrop(verdict.reason);
        return;
      }

      encodingRef.current = true;
      // keepFrame owns its own failures, but an unforeseen throw here would be an
      // unhandled rejection once per frame, which in dev buries the HUD under the
      // error overlay and in prod is silent. Terminate the chain explicitly.
      void keepFrame(video, now, fix as TrackPoint, verdict.blurScore)
        .catch(() => tallyDrop("write_failed"))
        .finally(() => {
          encodingRef.current = false;
        });
    },
    [grayFromVideo, keepFrame, tallyDrop],
  );

  useFrameClock({ videoRef, enabled: isRecording, onFrame: handleFrame });

  /* ---------------------------------------------------------------- *
   * Backgrounding
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (phase !== "recording") return;

    const pause = () => {
      const manifest = manifestRef.current;
      if (!manifest) return;
      manifestRef.current = closeSegment(manifest, Date.now());
      // Flush immediately. A tab that is hidden may never get another chance to
      // run our code before iOS discards it.
      void storeRef.current?.putManifest(manifestRef.current);
      // Actually release the camera, because that is what we tell the walker has
      // happened. Holding the track while backgrounded leaves the OS recording
      // indicator lit over another app, which would make the copy a lie.
      stopCamera();
      setPhase("paused");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
    };

    document.addEventListener("visibilitychange", onVisibility);
    // pagehide fires on bfcache eviction and iOS tab-switch paths where
    // visibilitychange alone is not reliable.
    window.addEventListener("pagehide", pause);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
    };
  }, [phase, stopCamera]);

  /* ---------------------------------------------------------------- *
   * Commands
   * ---------------------------------------------------------------- */
  const start = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;

    // A refused camera must NOT become a session. Entering "recording" anyway
    // unmounts the start screen, which is the only place the camera error is
    // rendered, leaving the walker on a black preview with a live REC dot and a
    // frame counter pinned at zero. So gate on the settled state the call
    // returns, not on `cameraState`, which is still last render's value here.
    const result = await startCamera();
    if (result.status !== "ready") return;

    const now = Date.now();
    const manifest = createManifest(crypto.randomUUID(), now);
    manifestRef.current = manifest;
    gateRef.current = { lastKeptT: null, lastKeptPosition: null, prevGray: null };
    latestFixRef.current = null;
    setStats(emptyStats());
    setReviewTrack([]);
    setCapReason(null);
    setStorageFull(false);
    setUploadFailure(null);
    await store.putManifest(manifest);
    setPhase("recording");
  }, [startCamera]);

  /** Resume after backgrounding, on a NEW sub-segment. */
  const resume = useCallback(async () => {
    const manifest = manifestRef.current;
    if (!manifest) return;
    // The camera was released on pause, so re-acquire it. This runs from the
    // walker's tap, which is the gesture iOS requires.
    const result = await startCamera();
    if (result.status !== "ready") {
      finishSession();
      return;
    }
    manifestRef.current = openSegment(manifest, Date.now());
    // The gate's memory of where we were is stale by however long the phone was
    // in a pocket. Clearing it lets the first frame back through immediately
    // rather than measuring displacement against a position from minutes ago.
    gateRef.current = { lastKeptT: null, lastKeptPosition: null, prevGray: null };
    void storeRef.current?.putManifest(manifestRef.current);
    setPhase("recording");
  }, [finishSession, startCamera]);

  const stop = finishSession;

  const discard = useCallback(async () => {
    const manifest = manifestRef.current;
    if (manifest) await storeRef.current?.discard(manifest.localId);
    manifestRef.current = null;
    setRecoverable(null);
    setReviewTrack([]);
    setStats(emptyStats());
    setUploadFailure(null);
    setPhase("idle");
  }, []);

  /** Adopt a recovered walk so it can be reviewed and uploaded. */
  const recoverSession = useCallback(() => {
    if (!recoverable) return;
    manifestRef.current = recoverable;
    setReviewTrack([...recoverable.track]);
    setStats({
      framesKept: recoverable.frames.length,
      dropCounts: { ...recoverable.dropCounts },
      distanceM: trackDistanceMeters(recoverable.track),
      elapsedMs: (recoverable.endedAt ?? Date.now()) - recoverable.startedAt,
      accuracyM: null,
      trackPoints: recoverable.track.length,
    });
    setRecoverable(null);
    setPhase("review");
  }, [recoverable]);

  const discardRecovered = useCallback(async () => {
    if (recoverable) await storeRef.current?.discard(recoverable.localId);
    setRecoverable(null);
    setPhase("idle");
  }, [recoverable]);

  const upload = useCallback(
    async (contact?: string) => {
      const store = storeRef.current;
      const manifest = manifestRef.current;
      if (!store || !manifest) return;

      setUploadFailure(null);
      setUploadProgress(null);
      setPhase("uploading");

      try {
        const frames = await store.loadFrames(manifest);
        const result = await uploadCapture({
          mode: "live",
          frames,
          track: manifest.track,
          source: "live",
          ...(contact ? { contact } : {}),
          // Resume rather than duplicate if a previous attempt got as far as
          // creating the session.
          ...(manifest.serverSessionId ? { sessionId: manifest.serverSessionId } : {}),
          onProgress: setUploadProgress,
        });

        manifest.serverSessionId = result.sessionId;
        manifest.phase = "uploaded";
        await store.putManifest(manifest);
        // The frames are on the server now; holding local copies just occupies a
        // phone. The manifest goes with them.
        await store.discard(manifest.localId);

        setSessionId(result.sessionId);
        setPhase("done");
      } catch (error) {
        setUploadFailure(classifyUploadError(error));
        // Back to review, frames untouched in OPFS. Retry is a button, not a
        // silent loop.
        setPhase("review");
      }
    },
    [],
  );

  const accuracyWarning = useMemo(
    () => stats.accuracyM !== null && stats.accuracyM >= CAPTURE_TUNING.accuracyWarnM,
    [stats.accuracyM],
  );

  return {
    phase,
    stats,
    durable,
    recoverable,
    capReason,
    storageFull,
    uploadProgress,
    uploadFailure,
    sessionId,
    accuracyWarning,
    camera: cameraState,
    geo: geo.state,
    wakeLock,
    unsupportedReason: unsupportedReason(),
    reviewTrack,
    videoRef,
    grayCanvasRef,
    jpegCanvasRef,
    start,
    resume,
    stop,
    discard,
    recoverSession,
    discardRecovered,
    upload,
  };
}
