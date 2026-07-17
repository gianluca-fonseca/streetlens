/**
 * Cheap per-frame vision, done on a 32x32 gray thumbnail.
 *
 * Both jobs a frame needs (is this the same picture as last time? is it too
 * blurry to score?) are answered from the same tiny buffer, so a walking phone
 * does ~1k pixel reads per frame instead of ~1M. That is the whole point: this
 * runs on a mid-range Android inside a `requestVideoFrameCallback`, and anything
 * expensive here shows up as dropped camera frames.
 *
 * Pure functions over plain typed arrays — no DOM, no React. That keeps them
 * unit-testable in node (`scripts/test-capture-gating.mjs`) and keeps the
 * thresholds honest.
 */

/**
 * Rec. 601 luma from RGBA bytes.
 *
 * Integer weights (77/150/29 over 256) rather than floats: the result is a byte
 * either way, and this stays exact and fast in a hot loop.
 */
export function toGray(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; p < out.length; i += 4, p += 1) {
    out[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

/**
 * Mean absolute difference between two gray thumbnails, in gray levels (0..255).
 *
 * This is the dedupe signal. It is deliberately not a perceptual hash: we are
 * not asking "are these the same place", we are asking "did the sensor hand back
 * a byte-identical redelivery or a phone that has not moved". Mean-abs-diff
 * answers that, degrades gracefully with sensor noise, and cannot false-positive
 * the way a hash-bucket collision can.
 *
 * Returns `Number.POSITIVE_INFINITY` when there is no previous frame, so the
 * first frame of a session always reads as "maximally different" and is kept.
 */
export function frameDelta(current: Uint8Array, previous: Uint8Array | null): number {
  if (previous === null) return Number.POSITIVE_INFINITY;
  if (previous.length !== current.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < current.length; i += 1) {
    total += Math.abs(current[i] - previous[i]);
  }
  return total / current.length;
}

/**
 * Variance of the Laplacian — the standard cheap sharpness proxy.
 *
 * A 4-neighbour Laplacian (`4*centre - up - down - left - right`) is a
 * second-derivative edge response. A sharp frame has strong edges and therefore
 * a wide spread of responses; a blurred one has weak edges and a narrow spread.
 * We take the variance of the response, not its mean, because the mean of a
 * Laplacian is ~0 for any image.
 *
 * Border pixels are skipped (no full neighbourhood). Returns 0 for a frame too
 * small to have an interior.
 */
export function laplacianVariance(gray: Uint8Array, size: number): number {
  if (size < 3 || gray.length !== size * size) return 0;

  const interior = (size - 2) * (size - 2);
  const responses = new Float64Array(interior);
  let mean = 0;

  for (let y = 1, k = 0; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1, k += 1) {
      const i = y * size + x;
      const value =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      responses[k] = value;
      mean += value;
    }
  }
  mean /= interior;

  let variance = 0;
  for (let k = 0; k < interior; k += 1) {
    const d = responses[k] - mean;
    variance += d * d;
  }
  return variance / interior;
}

/**
 * Fit a frame inside `maxLongestSide` without distorting it.
 *
 * Never upscales: a 640px camera on a cheap phone stays 640px rather than being
 * blown up to 1024 and costing bytes for pixels that carry no information.
 */
export function fitDimensions(
  width: number,
  height: number,
  maxLongestSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxLongestSide || longest === 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxLongestSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
