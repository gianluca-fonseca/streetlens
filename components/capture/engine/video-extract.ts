/**
 * Frame extraction from an uploaded video, via WebCodecs.
 *
 * The recorder walks a street and keeps a frame a second. This does the same
 * job to a video someone already shot, and the output has to be
 * indistinguishable: same JPEG treatment, same longest-side clamp, same blur
 * score, same `CaptureFrameMeta`. A frame that came from a file and a frame that
 * came from a camera must be the same kind of evidence, or the extraction model
 * is scoring two populations and nobody can tell which.
 *
 * Three things here are not obvious and all three are load-bearing:
 *
 * 1. **Decoded frames can arrive out of order.** iOS below 26.4 emits H.264
 *    B-frames in decode order rather than presentation order. Sampling straight
 *    off the output callback would therefore pick frames that are not the ones
 *    nearest the target times, and would do it only on some phones, which is the
 *    worst kind of bug. Everything goes through a small reorder buffer and is
 *    sampled in timestamp order.
 *
 * 2. **Every VideoFrame must be closed.** A VideoFrame is a handle on GPU or
 *    codec memory, and it is not garbage collected in any useful sense. Leak a
 *    few hundred and the decoder stalls, permanently, with no error. Every
 *    frame that enters this module leaves it through `close()`, in a `finally`,
 *    including the ones we keep and including the ones we drop on the way out
 *    of an abort.
 *
 * 3. **The decode queue is the real memory risk.** The demux hands us samples
 *    far faster than a phone decodes them. Pushing them all in would rebuild the
 *    whole-file allocation that `video-demux.ts` exists to avoid, just in codec
 *    memory instead of ArrayBuffers. `decode()` is throttled against
 *    `decodeQueueSize`.
 *
 * What this file deliberately does NOT do: gate frames. `engine/gating.ts` is
 * built around a live GPS stream (its first check is `no_fix`) and there is no
 * GPS here. The route does not exist yet at extraction time; it is drawn or
 * uploaded afterwards. Blur is measured and recorded, but a blurry frame is kept
 * rather than dropped: unlike a walker, an uploader cannot go back and re-shoot,
 * so a scored-unusable frame is worth more than a hole in the coverage.
 */

import { CAPTURE_LIMITS } from "@/lib/capture/types";
import { createFrameEncoder } from "@/components/capture/engine/frame-encode";
import { demuxVideo, type VideoTrackInfo } from "@/components/capture/engine/video-demux";
import {
  planExtraction,
  sampleTargetsMs,
  type ExtractionPlan,
} from "@/components/capture/engine/video-plan";

// Re-exported so a caller needs one import for the extraction vocabulary. The
// definitions live in `video-plan.ts` because this file imports mp4box, which is
// ESM-only, and the CommonJS test harness cannot `require()` through it.
export { planExtraction, sampleTargetsMs, type ExtractionPlan };

/**
 * How many decoded frames may sit in the reorder buffer.
 *
 * This has to exceed the longest B-frame reordering distance a phone will
 * produce, which in practice is a handful. 16 is comfortably past that while
 * still being a trivial amount of memory to hold. Too small and an out-of-order
 * frame gets sampled against the wrong target; too large and we hold GPU
 * handles for no reason.
 */
const REORDER_WINDOW = 16;

/**
 * Ceiling on frames queued into the decoder at once.
 *
 * The only job of this number is to stop the demux outrunning the decoder. Low
 * enough that a phone holds a bounded amount of codec memory, high enough that
 * the decoder is never idle waiting for us.
 */
const MAX_DECODE_QUEUE = 24;

export type ExtractedFrame = {
  seq: number;
  /** Milliseconds from the start of the video, NOT epoch. The caller adds the clock. */
  offsetMs: number;
  blob: Blob;
  width: number;
  height: number;
  blurScore: number;
};

export type ExtractionProgress = {
  framesKept: number;
  targetFrames: number;
  bytesRead: number;
  totalBytes: number;
};

/** Extraction could not run at all. `reason` is machine-ish for the UI. */
export class VideoExtractError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "VideoExtractError";
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

export type ExtractOptions = {
  /**
   * Called for each kept frame, awaited. This is where the caller writes the
   * JPEG to OPFS. Awaiting matters: it is the backpressure that stops a fast
   * decoder queueing hundreds of blobs in memory behind a slow disk.
   */
  onFrame: (frame: ExtractedFrame) => Promise<void>;
  onProgress?: (progress: ExtractionProgress) => void;
  /** Resume: frames with a seq below this are already on disk and are skipped. */
  resumeFromSeq?: number;
  maxFrames?: number;
  signal?: AbortSignal;
};

export type ExtractResult = {
  plan: ExtractionPlan;
  track: VideoTrackInfo;
  framesKept: number;
};

/**
 * True when this browser can decode this track with WebCodecs.
 *
 * Split out because it is the fallback's trigger: a false here sends the caller
 * to `video-seek.ts`, which is slower and less exact but works anywhere there is
 * a `<video>` element. Note the try/catch. `isConfigSupported` is specified to
 * REJECT on a malformed config rather than resolve `{supported: false}`, so a
 * codec string this browser cannot even parse arrives as a throw, not an answer.
 */
export async function canDecodeWithWebCodecs(info: VideoTrackInfo): Promise<boolean> {
  if (typeof VideoDecoder === "undefined") return false;
  try {
    const support = await VideoDecoder.isConfigSupported({
      codec: info.codec,
      codedWidth: info.width,
      codedHeight: info.height,
      ...(info.description ? { description: info.description } : {}),
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * Decode `file` and hand back ~1 fps of JPEGs.
 *
 * Throws `VideoExtractError("unsupported")` when WebCodecs cannot take the
 * track, which is the caller's signal to fall back to the seek path rather than
 * to give up.
 */
export async function extractFramesWithWebCodecs(
  file: Blob,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const { onFrame, onProgress, signal, resumeFromSeq = 0 } = opts;

  const encoder = createFrameEncoder();
  if (!encoder) throw new VideoExtractError("no_canvas");

  let info: VideoTrackInfo | null = null;
  let plan: ExtractionPlan | null = null;
  let targets: number[] = [];
  let targetIdx = 0;
  let kept = 0;
  let bytesRead = 0;
  let decodeError: Error | null = null;

  // A box rather than a plain `let`. The decoder is constructed inside the
  // demux's onTrack callback, which the compiler cannot see into, so it narrows
  // a bare local to `null` for the rest of the function and then refuses every
  // read of it. Narrowing on a property resets across the intervening await,
  // which is exactly the truth here.
  const dec: { current: VideoDecoder | null } = { current: null };

  /** Frames decoded but not yet sampled, kept sorted-on-drain by timestamp. */
  const reorder: VideoFrame[] = [];
  /** Work queued by the decoder's output callback, which cannot itself await. */
  let chain: Promise<void> = Promise.resolve();

  const closeAll = () => {
    while (reorder.length > 0) reorder.pop()?.close();
  };

  /**
   * Decide one frame's fate. Called in ascending timestamp order.
   *
   * `finally { close() }` is not decoration. Every path out of here, including
   * the encoder throwing and including the frame being dropped, releases the
   * handle.
   */
  const consider = async (frame: VideoFrame): Promise<void> => {
    try {
      if (!plan || targetIdx >= targets.length) return;

      const tsMs = frame.timestamp / 1_000;
      if (tsMs < targets[targetIdx]) return;

      const seq = targetIdx;

      // Advance past every target this frame satisfies. At a stretched interval
      // one frame can only ever answer one target, but at a low frame rate a
      // single frame can be the best available answer for several.
      while (targetIdx < targets.length && targets[targetIdx] <= tsMs) targetIdx += 1;

      if (seq < resumeFromSeq) return; // Already on disk from an earlier run.

      // `info.rotation` and not the frame: the decoder never saw the container's
      // transform matrix, so a portrait walk arrives here as a sideways sensor
      // frame and only the demux knows to turn it back.
      const encoded = await encoder.encode(
        frame,
        frame.displayWidth,
        frame.displayHeight,
        info?.rotation ?? 0,
      );
      if (!encoded) return;
      if (encoded.blob.size > CAPTURE_LIMITS.maxFrameBytes) return;

      await onFrame({
        seq,
        offsetMs: Math.round(tsMs),
        blob: encoded.blob,
        width: encoded.width,
        height: encoded.height,
        blurScore: encoded.blurScore,
      });

      kept += 1;
      onProgress?.({
        framesKept: kept,
        targetFrames: plan.targetFrames,
        bytesRead,
        totalBytes: file.size,
      });
    } finally {
      frame.close();
    }
  };

  /** Drain the reorder buffer down to `keep` frames, oldest-by-timestamp first. */
  const drainReorder = async (keep: number): Promise<void> => {
    while (reorder.length > keep) {
      reorder.sort((a, b) => a.timestamp - b.timestamp);
      const frame = reorder.shift();
      if (frame) await consider(frame);
    }
  };

  /** Wait for the decoder to work off its backlog. */
  const awaitQueue = async (): Promise<void> => {
    for (;;) {
      const d = dec.current;
      if (!d || d.decodeQueueSize <= MAX_DECODE_QUEUE) return;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise<void>((resolve) => {
        d.addEventListener("dequeue", () => resolve(), { once: true });
      });
    }
  };

  try {
    await demuxVideo(file, {
      signal,
      onProgress: (read) => {
        bytesRead = read;
        if (plan) {
          onProgress?.({
            framesKept: kept,
            targetFrames: plan.targetFrames,
            bytesRead: read,
            totalBytes: file.size,
          });
        }
      },

      onTrack: async (track) => {
        info = track;
        if (!(await canDecodeWithWebCodecs(track))) {
          throw new VideoExtractError("unsupported");
        }

        plan = planExtraction(track.durationMs, opts.maxFrames);
        targets = sampleTargetsMs(plan);
        if (targets.length === 0) throw new VideoExtractError("video_too_short");

        const created = new VideoDecoder({
          output: (frame) => {
            // Cannot await here: the spec calls this synchronously and a slow
            // consumer must not block the decoder's own thread. Park the frame
            // and let the chain sample it.
            reorder.push(frame);
            chain = chain.then(() => drainReorder(REORDER_WINDOW)).catch((err) => {
              decodeError ??= err instanceof Error ? err : new Error(String(err));
            });
          },
          error: (err) => {
            decodeError ??= err;
          },
        });

        created.configure({
          codec: track.codec,
          codedWidth: track.width,
          codedHeight: track.height,
          ...(track.description ? { description: track.description } : {}),
          // We sample roughly one frame a second and throw the rest away, so
          // the decoder is asked for speed rather than for every frame to be
          // perfect. It is free to ignore this.
          optimizeForLatency: true,
        });
        dec.current = created;

        return true;
      },

      onSamples: async (samples) => {
        const decoder = dec.current;
        if (!decoder) return;
        for (const sample of samples) {
          if (decodeError) throw decodeError;
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (targetIdx >= targets.length) return; // Every target answered.

          decoder.decode(
            new EncodedVideoChunk({
              type: sample.is_sync ? "key" : "delta",
              // Microseconds. cts/dts are in the track's own timescale, and
              // getting this conversion wrong silently shifts every sample.
              timestamp: (sample.cts / sample.timescale) * 1_000_000,
              duration: (sample.duration / sample.timescale) * 1_000_000,
              data: sample.data ?? new Uint8Array(0),
            }),
          );
          await awaitQueue();
        }
        await chain;
      },
    });

    // Flush before draining: frames still inside the decoder have not reached
    // the reorder buffer yet, and draining first would sample without them.
    if (dec.current?.state === "configured") await dec.current.flush();
    await chain;
    await drainReorder(0); // Everything still buffered, in order.
    if (decodeError) throw decodeError;
  } finally {
    closeAll();
    if (dec.current && dec.current.state !== "closed") dec.current.close();
  }

  if (!info || !plan) throw new VideoExtractError("no_video_track");
  return { plan, track: info, framesKept: kept };
}
