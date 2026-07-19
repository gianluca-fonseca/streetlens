/**
 * Shrink the frame ourselves, before it ever reaches the model.
 *
 * WHY THIS EXISTS. `detail: "low"` is supposed to cap an image at a fixed, tiny
 * token count. On 2026-07-16 the live smoke measured a 512-class fixture billed
 * at ~2565 image tokens on gpt-5-nano — full resolution, hint ignored, HTTP 200,
 * nothing to catch. That is a recurring provider regression, not a one-off, and
 * the cost model cannot rest on a hint someone else honours at their discretion.
 *
 * So we stop asking. The bytes we send ARE small: max 768 px on the longest
 * side, JPEG q70. At that size a betrayal is bounded — ~576 patches, ~1,420
 * tokens at nano's 2.46x multiplier — instead of unbounded. `detail: "low"`
 * still rides along in the request as belt-and-braces; this is the braces.
 *
 * 768 (up from 512) is the acuity floor for vehicle / road-center vantage:
 * raised sidewalks, bollards, and curb lines at the frame edge need the extra
 * pixels. The frames stay full-resolution in storage for human review; this
 * downscale is for the model's eyes only.
 */

import sharp from "sharp";

/** Longest side, in pixels, of what the model is sent. */
export const FRAME_MAX_EDGE_PX = 768;

/** JPEG quality of the downscaled frame. Enough for a rubric, not for a print. */
export const FRAME_JPEG_QUALITY = 70;

export type DownscaleOptions = {
  /** Injectable so the tests exercise the real resize without a network. */
  fetchImpl?: typeof fetch;
  maxEdgePx?: number;
  quality?: number;
};

/**
 * The frame bytes, from wherever the URL points.
 *
 * `data:` is handled without fetch on purpose: the live smoke feeds a committed
 * fixture in exactly that form, and Node's fetch support for the scheme is not
 * something worth depending on.
 */
async function readImageBytes(imageUrl: string, fetchImpl: typeof fetch): Promise<Buffer> {
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    if (comma === -1) throw new Error("malformed data: URL");
    const meta = imageUrl.slice(0, comma);
    const payload = imageUrl.slice(comma + 1);
    return meta.includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "binary");
  }

  const response = await fetchImpl(imageUrl);
  if (!response.ok) {
    throw new Error(`frame fetch ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch a frame and return it as a small JPEG data URL, ready to send.
 *
 * `.rotate()` first: the JPEG re-encode drops EXIF, so an orientation tag that
 * is not baked into the pixels here would silently arrive sideways at the model.
 * `withoutEnlargement` so an already-small frame is not upscaled into more
 * tokens than it needs.
 */
export async function downscaleFrame(
  imageUrl: string,
  options: DownscaleOptions = {},
): Promise<string> {
  const maxEdge = options.maxEdgePx ?? FRAME_MAX_EDGE_PX;
  const bytes = await readImageBytes(imageUrl, options.fetchImpl ?? fetch);

  const resized = await sharp(bytes)
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: options.quality ?? FRAME_JPEG_QUALITY })
    .toBuffer();

  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}
