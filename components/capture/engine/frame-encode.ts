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
// The single definition lives with the matrix read that produces it, so the
// encoder and the demux cannot disagree about what a rotation is.
import type { FrameRotation } from "@/components/capture/engine/video-plan";
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
   * and a canvas has neither. The caller knows which it holds. They are the
   * CODED dimensions; `rotation` is applied on top of them here.
   */
  encode(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    rotation?: FrameRotation,
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
 * Draw `source` into a `destW` x `destH` canvas, turned `rotation` degrees
 * clockwise and filling the destination.
 *
 * The transform is set and then reset rather than saved and restored, because
 * this runs a few hundred times per video and the context has no other state
 * worth preserving.
 *
 * `destW`/`destH` are the POST-rotation dimensions, so for a quarter turn the
 * source has to be drawn at the swapped extents inside the rotated frame. Getting
 * this backwards does not throw. It silently letterboxes every frame, which is
 * the sort of thing that ships.
 */
function drawUpright(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: CanvasImageSource,
  destW: number,
  destH: number,
  rotation: FrameRotation,
): void {
  if (rotation === 0) {
    ctx.drawImage(source, 0, 0, destW, destH);
    return;
  }

  const upright = rotation === 90 || rotation === 270;
  const drawW = upright ? destH : destW;
  const drawH = upright ? destW : destH;

  ctx.translate(destW / 2, destH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    async encode(source, srcW, srcH, rotation = 0) {
      // A quarter turn swaps what "longest side" even means, so the clamp is
      // applied to the DISPLAY shape, not the coded one. Fitting first and
      // rotating after would clamp the wrong axis and letterbox a portrait walk.
      const upright = rotation === 90 || rotation === 270;
      const { width, height } = fitDimensions(
        upright ? srcH : srcW,
        upright ? srcW : srcH,
        CAPTURE_TUNING.maxLongestSide,
      );
      if (width === 0 || height === 0) return null;

      jpeg.resize(width, height);
      drawUpright(jpeg.ctx, source, width, height, rotation);
      const blob = await jpeg.toBlob();
      if (!blob) return null;

      // Squashed to a square, aspect deliberately NOT preserved. Both dedupe and
      // blur are scale-free, and this is exactly what the live recorder measures.
      // Rotated anyway: a square of a sideways frame is not the same pixels as a
      // square of an upright one, and the seek path would measure the upright one.
      gray.resize(size, size);
      drawUpright(gray.ctx, source, size, size, rotation);
      const bytes = toGray(gray.ctx.getImageData(0, 0, size, size).data);

      return { blob, width, height, blurScore: laplacianVariance(bytes, size), gray: bytes };
    },
  };
}
