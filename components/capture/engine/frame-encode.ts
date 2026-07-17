/**
 * The one place a captured frame becomes a JPEG.
 *
 * There are three ways a frame reaches the funnel: the live recorder's camera
 * preview, the WebCodecs decode of an uploaded video, and the seek-loop fallback
 * for browsers that will not decode. All three must produce the SAME artifact.
 * Not similar: the same. The extraction model scores these frames against a
 * rubric and rolls the answers up into a street's score, so if one path quietly
 * encoded at a different quality or clamped to a different longest side, the
 * model would be scoring two populations and no one downstream could tell which
 * frame came from where or why the numbers moved.
 *
 * That invariant cannot survive being written down twice. This module exists
 * because it WAS written twice (the WebCodecs path and the seek path each grew
 * their own copy), and two copies of an invariant is just a slower way of not
 * having one. The tuning that matters (`maxLongestSide`, `jpegQuality`,
 * `graySize`) is read from `CAPTURE_TUNING`, so the recorder's numbers and these
 * numbers cannot drift apart either.
 *
 * The gray thumbnail comes back alongside the JPEG rather than being recomputed
 * by callers who want it. The blur score already needs those pixels, and the
 * seek path needs the same buffer again to notice a wedged `<video>` element
 * handing it the same frame twice. Computing it once and returning it is cheaper
 * than a second readback, and readbacks are the expensive part.
 */

import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";
import {
  fitDimensions,
  laplacianVariance,
  toGray,
} from "@/components/capture/engine/frame-analysis";

export type EncodedFrame = {
  blob: Blob;
  width: number;
  height: number;
  /** Variance-of-Laplacian sharpness. Higher is sharper. */
  blurScore: number;
  /**
   * The squashed 32x32 gray the blur score was computed from.
   *
   * Returned rather than recomputed because the pixels are already in hand, and
   * `getImageData` is the expensive step. The seek fallback compares consecutive
   * buffers to detect a stuck element; the WebCodecs path ignores this.
   */
  gray: Uint8Array;
};

export type FrameEncoder = {
  /**
   * `srcW`/`srcH` are passed explicitly rather than read off the source: a
   * VideoFrame reports `displayWidth`, an HTMLVideoElement reports `videoWidth`,
   * and a canvas has neither. The caller knows which it holds.
   */
  encode(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
  ): Promise<EncodedFrame | null>;
};

type Canvas2D = {
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  toBlob(): Promise<Blob | null>;
  resize(w: number, h: number): void;
};

function createCanvas(readFrequently: boolean): Canvas2D | null {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas");

  // `willReadFrequently` matters on the gray canvas: without it the browser
  // keeps the surface on the GPU and every getImageData is a full readback
  // stall. Same reasoning as the live recorder's grayFromVideo.
  const ctx = canvas.getContext("2d", { willReadFrequently: readFrequently }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  return {
    ctx,
    resize(w: number, h: number) {
      canvas.width = w;
      canvas.height = h;
    },
    toBlob() {
      if (canvas instanceof OffscreenCanvas) {
        return canvas.convertToBlob({
          type: "image/jpeg",
          quality: CAPTURE_TUNING.jpegQuality,
        });
      }
      return new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", CAPTURE_TUNING.jpegQuality),
      );
    },
  };
}

/**
 * Build an encoder holding its own two canvases.
 *
 * The canvases are created once and resized per frame rather than allocated per
 * frame: this runs a few hundred times over a long video, and a fresh canvas
 * each time is a fresh GPU surface each time.
 *
 * Returns null where there is no 2D context to be had at all, which the caller
 * must treat as "cannot extract here" rather than ignoring.
 */
export function createFrameEncoder(): FrameEncoder | null {
  const jpeg = createCanvas(false);
  const gray = createCanvas(true);
  if (!jpeg || !gray) return null;

  const size = CAPTURE_TUNING.graySize;

  return {
    async encode(source, srcW, srcH) {
      const { width, height } = fitDimensions(srcW, srcH, CAPTURE_TUNING.maxLongestSide);
      if (width === 0 || height === 0) return null;

      jpeg.resize(width, height);
      jpeg.ctx.drawImage(source, 0, 0, width, height);
      const blob = await jpeg.toBlob();
      if (!blob) return null;

      // Squashed to a square, aspect deliberately NOT preserved. Both dedupe and
      // blur are scale-free, and this is exactly what the live recorder measures.
      gray.resize(size, size);
      gray.ctx.drawImage(source, 0, 0, size, size);
      const bytes = toGray(gray.ctx.getImageData(0, 0, size, size).data);

      return { blob, width, height, blurScore: laplacianVariance(bytes, size), gray: bytes };
    },
  };
}
