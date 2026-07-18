"use client";

/**
 * The recorder shell: owns the video element and picks the screen for the phase.
 *
 * The camera preview and the two work canvases live here and are mounted for the
 * whole session rather than per screen. Remounting a <video> tears down and
 * re-attaches the MediaStream, which on a phone shows up as a black flash and a
 * fresh autoplay negotiation every time the walker pauses. They stay put; only
 * their visibility changes.
 */

import { useEffect } from "react";
import { useRecorder } from "@/components/capture/hooks/useRecorder";
import { StartScreen } from "@/components/capture/screens/StartScreen";
import { RecordingHUD } from "@/components/capture/screens/RecordingHUD";
import { ReviewScreen } from "@/components/capture/screens/ReviewScreen";
import { DoneScreen } from "@/components/capture/screens/DoneScreen";
import { RecoverScreen, UnsupportedScreen } from "@/components/capture/screens/GateScreens";
import type { SegmentBrief } from "@/lib/capture/segment-brief";

export default function LiveRecorder({
  spotBrief,
}: Readonly<{ spotBrief?: SegmentBrief | null }>) {
  // Destructured in full, not held as `recorder.x`. The hook's return carries
  // refs, and the compiler's alias analysis taints the whole object once it does:
  // every property read off it, ref or not, then trips react-hooks/refs.
  const {
    camera,
    videoRef,
    grayCanvasRef,
    jpegCanvasRef,
    phase,
    stats,
    geo,
    wakeLock,
    accuracyWarning,
    durable,
    recoverable,
    capReason,
    storageFull,
    uploadProgress,
    uploadFailure,
    sessionId,
    unsupportedReason: unsupported,
    reviewTrack,
    start,
    resume,
    stop,
    discard,
    recoverSession,
    discardRecovered,
    upload,
  } = useRecorder();

  // Attach the stream to the element. An effect, not a render-time assignment:
  // srcObject is DOM state, and this is exactly the "synchronise with an external
  // system" case effects are for.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (camera.status === "ready") {
      video.srcObject = camera.stream;
      // Autoplay can still reject (iOS low-power mode). The frame clock simply
      // produces nothing until there are frames, so there is no error to raise.
      void video.play().catch(() => undefined);
    } else {
      video.srcObject = null;
    }
  }, [camera, videoRef]);

  const showPreview = phase === "recording" || phase === "paused";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Kept mounted across phases; hidden rather than unmounted. `playsInline`
          is what stops iOS hijacking this into a fullscreen player. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className={
          showPreview
            ? "absolute inset-0 size-full bg-black object-cover"
            : "pointer-events-none absolute size-0 opacity-0"
        }
      />
      {/* Work surfaces: the 32x32 gray thumbnail and the JPEG encode target.
          Never displayed. */}
      <canvas ref={grayCanvasRef} className="hidden" aria-hidden="true" />
      <canvas ref={jpegCanvasRef} className="hidden" aria-hidden="true" />

      {phase === "unsupported" && unsupported ? (
        <UnsupportedScreen reason={unsupported} />
      ) : null}

      {phase === "recover" && recoverable ? (
        <RecoverScreen
          manifest={recoverable}
          onRecover={recoverSession}
          onDiscard={() => void discardRecovered()}
        />
      ) : null}

      {phase === "idle" ? (
        <StartScreen
          onStart={() => void start()}
          starting={camera.status === "starting"}
          camera={camera}
          durable={durable}
          spotBrief={spotBrief}
        />
      ) : null}

      {showPreview ? (
        <RecordingHUD
          stats={stats}
          geo={geo}
          wakeLock={wakeLock}
          accuracyWarning={accuracyWarning}
          durable={durable}
          paused={phase === "paused"}
          onStop={stop}
          onResume={() => void resume()}
        />
      ) : null}

      {phase === "review" || phase === "uploading" ? (
        <ReviewScreen
          stats={stats}
          track={reviewTrack}
          capReason={capReason}
          storageFull={storageFull}
          uploading={phase === "uploading"}
          uploadProgress={uploadProgress}
          uploadFailure={uploadFailure}
          onUpload={(contact) => void upload(contact)}
          onDiscard={() => void discard()}
        />
      ) : null}

      {phase === "done" ? (
        <DoneScreen
          sessionId={sessionId}
          frameCount={stats.framesKept}
          distanceM={stats.distanceM}
          elapsedMs={stats.elapsedMs}
          track={reviewTrack}
          streetNames={spotBrief ? [spotBrief.name] : undefined}
          submittedAt={new Date()}
          onAgain={() => void discard()}
        />
      ) : null}
    </div>
  );
}
