/**
 * Frame extraction from an uploaded video, via a plain `<video>` element.
 *
 * This is the fallback under `video-extract.ts`. When `canDecodeWithWebCodecs`
 * says no, or extraction throws `VideoExtractError("unsupported")`, the walk is
 * still sitting there on the phone and refusing it is not an answer. Anything
 * that can play a video can be seeked and drawn to a canvas, so this path trades
 * speed and precision for reach: it is slower by roughly the settle time per
 * frame, and it lands on whatever frame the element decides is nearest the
 * requested time rather than on an exact timestamp. Both are acceptable when the
 * alternative is no frames at all.
 *
 * The sampling decision is NOT re-made here. `planExtraction` and
 * `sampleTargetsMs` are imported from the WebCodecs path, so the two produce the
 * same targets from the same duration. Encoding goes through the shared
 * `frame-encode.ts` for the same reason. Which path a frame came out of must be
 * invisible downstream, or the extraction model is scoring two populations
 * without anyone being able to tell which is which.
 *
 * Four browser behaviours drive almost every line below, and none of them are
 * guessable from the spec:
 *
 * 1. **`seeked` fires before the frame is painted.** In several browsers the
 *    event means "the seek is resolved", not "the pixels are ready", so drawing
 *    on the event hands you the PREVIOUS frame. Every kept frame is therefore
 *    read a short settle later. This is the single most load-bearing line in the
 *    file, and it is also the entire reason this path is slow.
 *
 * 2. **Seeks must be serial.** Assigning `currentTime` while a seek is in flight
 *    does not queue: the element coalesces, and the frames come back wrong or
 *    duplicated with no error. The loop here is strictly one seek at a time, and
 *    that is not an implementation convenience to be optimised away later.
 *
 * 3. **Some elements simply stop advancing** and hand back the same picture for
 *    every subsequent seek. Nothing is thrown; the extraction just quietly
 *    becomes 400 copies of one frame. That is worse than a failure, so it is
 *    detected and turned into one. See `MAX_STUCK_SAMPLES` for the policy and
 *    the honest cost of it.
 *
 * 4. **A blob URL pins the file.** `URL.createObjectURL(file)` keeps the whole
 *    thing alive until it is revoked, which would undo the effort
 *    `video-demux.ts` spends never holding a 2 GB video in memory. It is revoked
 *    in a `finally`, on every path out, including aborts.
 *
 * Every wait in here is both abortable and timed out. A `seeked` that never
 * arrives is a real outcome on a damaged file, and without a timeout it is an
 * extraction that hangs forever with a spinner and no way back.
 */

import { CAPTURE_LIMITS } from "@/lib/capture/types";
import { frameDelta } from "@/components/capture/engine/frame-analysis";
import { createFrameEncoder } from "@/components/capture/engine/frame-encode";
import {
  planExtraction,
  sampleTargetsMs,
  VideoExtractError,
  type ExtractionPlan,
  type ExtractOptions,
} from "@/components/capture/engine/video-extract";

/**
 * How long to wait after `seeked` before reading pixels.
 *
 * There is no event for "the frame is now painted" on this path.
 * `requestVideoFrameCallback` would be the right answer and is not available
 * everywhere this fallback has to run, which is the whole reason we are here. So
 * we wait. 100 ms is well past the compositor's worst case on the phones this
 * targets while still keeping a 400 frame extraction inside a minute of settle
 * time. Lower it and the bug it prevents (drawing the previous frame) comes back
 * on exactly the slow devices that end up on this path.
 */
const SETTLE_MS = 100;

/**
 * Ceiling on one seek.
 *
 * A seek into a healthy file resolves in well under a second. This is not a
 * performance budget, it is the line between "slow phone" and "this element is
 * never going to answer", and it only ever fires on the second.
 */
const SEEK_TIMEOUT_MS = 10_000;

/**
 * Ceiling on getting the metadata.
 *
 * Generous, deliberately. The element has to find the moov, and a recording that
 * was never faststarted keeps it at the very end of the file, so this can mean
 * hunting through a gigabyte or two before the duration is known.
 */
const METADATA_TIMEOUT_MS = 30_000;

/**
 * Consecutive identical samples before we call the element wedged.
 *
 * The tradeoff here is real and worth stating plainly. A walker paused at a
 * light produces frames that decode identically, so one repeat (and two) are
 * legitimate and are kept. At three consecutive repeats we abort with
 * `seek_stuck` rather than keep going. That WILL occasionally end an extraction
 * on a genuinely static stretch, which is the price: the alternative is emitting
 * hundreds of duplicates of one frame and calling it a walk, and a loud failure
 * the user can retry beats a silent one they cannot see.
 */
const MAX_STUCK_SAMPLES = 3;

/**
 * What this path can honestly say about the video.
 *
 * NOT `VideoTrackInfo`, and not `ExtractResult`. A `<video>` element knows its
 * display size and its duration and nothing else: no codec string, no timescale,
 * no sample count. Synthesising a `VideoTrackInfo` would mean inventing values
 * that read as parsed facts, and a fabricated codec string is exactly the kind of
 * lie that surfaces three modules later as an impossible bug. The caller reaches
 * this path from a failed `canDecodeWithWebCodecs(info)`, so it already holds the
 * real probed `VideoTrackInfo`; it does not need us to hand one back.
 *
 * Note `width`/`height` are the element's `videoWidth`/`videoHeight`, which are
 * display dimensions with the aspect correction applied. Those can disagree with
 * the coded dimensions `video-demux.ts` reports. That is not a discrepancy to fix:
 * it is what was drawn.
 */
export type SeekTrackInfo = {
  width: number;
  height: number;
  durationMs: number;
  /** Where these numbers came from, so nobody mistakes them for demuxed truth. */
  source: "video_element";
};

export type SeekExtractResult = {
  plan: ExtractionPlan;
  track: SeekTrackInfo;
  framesKept: number;
};


/* ------------------------------------------------------------------ *
 * Waiting, abortably and with a deadline
 * ------------------------------------------------------------------ */

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** Sleep, unless the caller gives up first. */
function settle(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wait for one event on the element, or fail loudly.
 *
 * The element's own `error` event is watched alongside the wanted one, because a
 * file the element cannot handle reports it there and nowhere else: without this
 * listener a decode failure is indistinguishable from a slow phone, and we would
 * sit on it for the whole timeout before saying anything useful.
 */
function waitForEvent(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked",
  timeoutMs: number,
  reason: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new VideoExtractError(reason, video.error?.message ?? reason));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new VideoExtractError(`${reason}_timeout`));
    }, timeoutMs);

    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Put the element on one frame and wait until that frame is actually there.
 *
 * The `seeked` wait and the settle are two separate facts, not one: the first
 * says the element accepted the position, the second is the only way we have of
 * knowing the pixels caught up. The early return covers the case where we are
 * already at the requested time, which is worth handling because assigning the
 * current `currentTime` back onto the element is not a seek at all in some
 * browsers, fires nothing, and would burn the full timeout.
 */
async function seekTo(
  video: HTMLVideoElement,
  seconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (Math.abs(video.currentTime - seconds) > 1e-3) {
    const seeked = waitForEvent(video, "seeked", SEEK_TIMEOUT_MS, "seek_failed", signal);
    video.currentTime = seconds;
    await seeked;
  }
  await settle(SETTLE_MS, signal);
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/**
 * Seek `file` at the planned cadence and hand back ~1 fps of JPEGs.
 *
 * The signature mirrors `extractFramesWithWebCodecs` (same `ExtractOptions`,
 * same honoured `resumeFromSeq` / `onFrame` / `onProgress` / `maxFrames` /
 * `signal`); only the result narrows. See `SeekTrackInfo` for why.
 */
/**
 * Read a video's duration and dimensions off a `<video>` element, then stop.
 *
 * The container probe in `video-demux.ts` is the better answer when it works,
 * but it only works on what mp4box can parse. This is the fallback's fallback:
 * the element will report a duration for anything the browser can play at all,
 * including containers mp4box has never heard of.
 *
 * The caller needs this BEFORE extraction rather than during it, because the
 * checkpoint manifest is built from the plan and the plan is built from the
 * duration. Committing to a manifest only once the first frame arrived would
 * mean a tab killed during the first minute of a long decode had nothing to
 * resume from, which is the exact case checkpointing exists for.
 *
 * `extractFramesWithSeek` re-derives the plan from the same duration rather than
 * taking it as an argument. That is deliberate: `planExtraction` is pure, so the
 * two calls cannot disagree, and the extractor stays usable on its own.
 */
export async function probeVideoElement(
  file: Blob,
  signal?: AbortSignal,
): Promise<SeekTrackInfo> {
  if (typeof document === "undefined") throw new VideoExtractError("no_video_element");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    video.load();
    await waitForEvent(video, "loadedmetadata", METADATA_TIMEOUT_MS, "video_load_failed", signal);

    const durationMs = video.duration * 1_000;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new VideoExtractError("unknown_duration");
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs,
      source: "video_element",
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function extractFramesWithSeek(
  file: Blob,
  opts: ExtractOptions,
): Promise<SeekExtractResult> {
  const { onFrame, onProgress, signal, resumeFromSeq = 0 } = opts;

  const encoder = createFrameEncoder();
  if (!encoder) throw new VideoExtractError("no_canvas");
  if (typeof document === "undefined") throw new VideoExtractError("no_video_element");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  // Never appended to the document. Muted and not autoplaying because we want
  // decode, not playback: an element that plays would race our seeks, and on
  // iOS an unmuted one would need a user gesture we do not have here.
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    video.load();
    await waitForEvent(
      video,
      "loadedmetadata",
      METADATA_TIMEOUT_MS,
      "video_load_failed",
      signal,
    );

    const durationMs = video.duration * 1_000;
    // Blob-URL videos report Infinity for a live-ish stream and NaN for a file
    // whose duration the element could not work out. Neither is a number a plan
    // can be built from, and `planExtraction(NaN)` would return a plan full of
    // NaN rather than complain, so this is the last place the lie can be caught.
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new VideoExtractError("unknown_duration");
    }

    const plan = planExtraction(durationMs, opts.maxFrames);
    const targets = sampleTargetsMs(plan);
    if (targets.length === 0) throw new VideoExtractError("video_too_short");

    const track: SeekTrackInfo = {
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs,
      source: "video_element",
    };

    let kept = 0;
    let stuckRun = 0;
    let previousGray: Uint8Array | null = null;

    for (let seq = 0; seq < targets.length; seq += 1) {
      if (signal?.aborted) throw abortError();

      // Frames below the resume point are already on disk. Skipped before the
      // seek, not after: the seek is the expensive part, and a resumed run that
      // paid for it would be no faster than starting over.
      if (seq < resumeFromSeq) continue;

      // Clamped a hair inside the duration. A seek past the end is not an error
      // anywhere, it just never fires `seeked`, so an off-by-a-rounding target
      // would cost a full timeout instead of a frame.
      const seconds = Math.min(targets[seq] / 1_000, video.duration - 1e-3);
      await seekTo(video, seconds, signal);

      const encoded = await encoder.encode(video, video.videoWidth, video.videoHeight);
      if (!encoded) continue;

      // Byte-identical rather than a threshold compare. `frameDelta`'s tolerance
      // exists for a camera sensor, whose noise means two looks at the same wall
      // are never quite equal. These pixels came out of a decoder instead, so a
      // redelivery is exact and anything above zero is real change. Exact also
      // cannot collide the way a hash of the thumbnail could, and it reads the
      // same 1k buffer the blur score already needed.
      if (previousGray && frameDelta(encoded.gray, previousGray) === 0) {
        stuckRun += 1;
        if (stuckRun >= MAX_STUCK_SAMPLES) throw new VideoExtractError("seek_stuck");
      } else {
        stuckRun = 0;
      }
      previousGray = encoded.gray;

      if (encoded.blob.size > CAPTURE_LIMITS.maxFrameBytes) continue;

      await onFrame({
        seq,
        offsetMs: Math.round(targets[seq]),
        blob: encoded.blob,
        width: encoded.width,
        height: encoded.height,
        blurScore: encoded.blurScore,
      });

      kept += 1;
      onProgress?.({
        framesKept: kept,
        targetFrames: plan.targetFrames,
        // An ESTIMATE, and the only dishonest-looking number here, so: this path
        // never reads the file itself (the element does), so there is no true
        // byte count to report. Bytes are roughly linear in playback position,
        // which makes position a fair proxy for a progress bar. The truthful
        // signal is framesKept against targetFrames; prefer it in the UI.
        bytesRead: Math.round(file.size * Math.min(1, targets[seq] / plan.durationMs)),
        totalBytes: file.size,
      });
    }

    return { plan, track, framesKept: kept };
  } finally {
    // Order matters a little: drop the element's hold on the URL before revoking
    // it, so nothing is mid-read when the blob goes. Leaking the URL would pin
    // the entire file for the life of the document, which is the one thing this
    // whole subsystem is built to avoid.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
