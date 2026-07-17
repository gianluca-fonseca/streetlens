"use client";

/**
 * The uploaded-video shell: picks the screen for the phase, and nothing else.
 *
 * `LiveRecorder`'s sibling, deliberately thinner than it. That shell owns a
 * `<video>` and two canvases and keeps them mounted across phases, because
 * remounting an element bound to a MediaStream costs a black flash and a fresh
 * autoplay negotiation on a phone. Nothing here has that problem: the decoders
 * own their own elements inside the engine, and the only long-lived thing on this
 * path is the manifest, which lives in the hook. So this file is the phase switch
 * and the argument list, and it should stay that way. Logic that shows up here is
 * logic that belongs in `useVideoUpload`.
 *
 * WHY `probing` AND `extracting` SHARE A SCREEN. They are one wait as far as the
 * contributor is concerned: the file was picked and the device is chewing on it.
 * Splitting them would be a screen change that carries no decision and no new
 * information. `VideoExtractScreen` knows the difference (the plan is null until
 * the probe lands) and says the honest thing for each.
 *
 * WHY `review` AND `uploading` SHARE A SCREEN. Same call the live path makes, for
 * the same reason: an upload failure returns the phase to `review`, and the retry
 * lives on the screen the contributor was already looking at.
 *
 * THE `route` NARROWING. `VideoReviewScreen` takes a non-null route, a non-null
 * plan and a non-null file, because reviewing a video with no route is not a
 * state, it is a bug. The hook guarantees all three by the time the phase is
 * `review` (it only gets there through `applyRoute`, which only runs on a
 * manifest that exists). The guard here is the compiler's proof of that, not a
 * defence against it: if it ever renders nothing, the invariant broke upstream.
 */

import { useVideoUpload } from "@/components/capture/hooks/useVideoUpload";
import { VideoStartScreen } from "@/components/capture/screens/video/VideoStartScreen";
import { VideoExtractScreen } from "@/components/capture/screens/video/VideoExtractScreen";
import { VideoRouteScreen } from "@/components/capture/screens/video/VideoRouteScreen";
import { VideoReviewScreen } from "@/components/capture/screens/video/VideoReviewScreen";
import { VideoDoneScreen } from "@/components/capture/screens/video/VideoDoneScreen";

export default function VideoUploader({ onBack }: Readonly<{ onBack?: () => void }>) {
  // Destructured in full, not held as `upload.x`, for the same reason
  // `LiveRecorder` does it: the hook's return carries refs, and the compiler's
  // alias analysis taints the whole object once it does. Every property read off
  // it, ref or not, then trips react-hooks/refs.
  const {
    phase,
    file,
    plan,
    decodePath,
    framesKept,
    route,
    track,
    clockOffsetMs,
    clockNudgeMatters,
    error,
    storageFull,
    durable,
    uploadProgress,
    uploadFailure,
    sessionId,
    pickFile,
    applyRoute,
    nudgeClock,
    upload,
    discard,
  } = useVideoUpload();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {phase === "idle" ? (
        <VideoStartScreen
          onPick={(picked) => void pickFile(picked)}
          onBack={onBack}
          error={error}
          durable={durable}
        />
      ) : null}

      {phase === "probing" || phase === "extracting" ? (
        <VideoExtractScreen
          probing={phase === "probing"}
          plan={plan}
          framesKept={framesKept}
          decodePath={decodePath}
          storageFull={storageFull}
          onDiscard={() => void discard()}
        />
      ) : null}

      {phase === "route" ? (
        <VideoRouteScreen
          onConfirm={(next) => void applyRoute(next)}
          onDiscard={() => void discard()}
        />
      ) : null}

      {(phase === "review" || phase === "uploading") && file && plan && route ? (
        <VideoReviewScreen
          file={file}
          plan={plan}
          framesKept={framesKept}
          route={route}
          track={track}
          clockOffsetMs={clockOffsetMs}
          clockNudgeMatters={clockNudgeMatters}
          storageFull={storageFull}
          durable={durable}
          uploading={phase === "uploading"}
          uploadProgress={uploadProgress}
          uploadFailure={uploadFailure}
          onNudge={(offsetMs) => void nudgeClock(offsetMs)}
          onUpload={(contact) => void upload(contact)}
          onDiscard={() => void discard()}
        />
      ) : null}

      {phase === "done" ? (
        <VideoDoneScreen sessionId={sessionId} onAgain={() => void discard()} />
      ) : null}
    </div>
  );
}
