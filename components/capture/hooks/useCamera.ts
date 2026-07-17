"use client";

/**
 * The rear camera.
 *
 * Two things here are not negotiable and both come from mobile reality rather
 * than from taste:
 *
 * 1. `start()` may only ever be called from a real user gesture. iOS Safari
 *    silently refuses `getUserMedia` outside one, and it does not report this as
 *    a permission error, it simply never resolves the way you expect. So the
 *    hook exposes an explicit `start`, and the UI puts it behind a tap.
 * 2. `facingMode: { exact: "environment" }` is requested first and then RETRIED
 *    without `exact`. The exact form is the only way to guarantee we are not
 *    handed a selfie camera, but it throws `OverconstrainedError` on the many
 *    devices that do not label their cameras properly. Asking loosely first
 *    would quietly record 400 frames of the walker's face.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Why the camera is not available, in terms the UI can explain honestly. */
export type CameraErrorReason =
  | "insecure_context"
  | "unsupported"
  | "denied"
  | "not_found"
  | "in_use"
  | "unknown";

export type CameraState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "ready"; stream: MediaStream; width: number; height: number }
  | { status: "error"; reason: CameraErrorReason };

/**
 * `getUserMedia` needs a secure context, and this is a page whose entire purpose
 * is the camera, so an insecure origin is a dead end worth naming rather than a
 * generic failure. localhost counts as secure, which is what makes dev work.
 */
export function isSecureCameraContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

export function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function classify(error: unknown): CameraErrorReason {
  if (!(error instanceof DOMException)) return "unknown";
  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "not_found";
    case "NotReadableError":
    case "AbortError":
      // Another app or tab holds the camera. Common on Android.
      return "in_use";
    default:
      return "unknown";
  }
}

const IDEAL_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;

export function useCamera() {
  const [state, setState] = useState<CameraState>({ status: "idle" });
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState({ status: "idle" });
  }, []);

  /**
   * Returns the state it settled on, as well as storing it.
   *
   * The caller needs the answer NOW, not on the next render: `useRecorder.start`
   * has to decide whether a session may begin at all, and reading `state` there
   * would read the previous render's value and start recording from a camera
   * that was just refused.
   */
  const start = useCallback(async (): Promise<CameraState> => {
    const fail = (reason: CameraErrorReason): CameraState => {
      const next: CameraState = { status: "error", reason };
      setState(next);
      return next;
    };

    if (!isSecureCameraContext()) return fail("insecure_context");
    if (!isCameraSupported()) return fail("unsupported");

    setState({ status: "starting" });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" }, ...IDEAL_SIZE },
        audio: false,
      });
    } catch (error) {
      // OverconstrainedError means "no camera admits to facing outward", not
      // "no camera". Plenty of devices simply do not label theirs, so fall back
      // to the advisory form, which those devices do honour.
      if (error instanceof DOMException && error.name === "OverconstrainedError") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", ...IDEAL_SIZE },
            audio: false,
          });
        } catch (retryError) {
          return fail(classify(retryError));
        }
      } else {
        return fail(classify(error));
      }
    }

    streamRef.current = stream;

    // Read back what we actually got. The `ideal` constraints are a request, not
    // a promise, and every frame's recorded width/height must be what the sensor
    // gave us rather than what we asked for.
    const settings = stream.getVideoTracks()[0]?.getSettings();
    const next: CameraState = {
      status: "ready",
      stream,
      width: settings?.width ?? 0,
      height: settings?.height ?? 0,
    };
    setState(next);
    return next;
  }, []);

  // Releasing the camera on unmount is not politeness, it is the difference
  // between a recording light that goes off when you leave the page and one that
  // does not. Ref-based so this runs exactly once, on teardown.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { state, start, stop };
}
