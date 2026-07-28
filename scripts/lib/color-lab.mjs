/*
 * color-lab.mjs — the perceptual colour maths the score ramps are built and
 * tested with. No dependencies, no design opinions: conversions, distances,
 * contrast, and colour-vision simulation only.
 *
 * Used by scripts/design-ramps.mjs (which SOLVES the ramp table) and by
 * scripts/test-ramp-legibility.mjs (which re-derives the rules and fails if a
 * future edit breaks them). Keeping one implementation means the tool that
 * proposes a ramp and the test that guards it cannot disagree.
 *
 * Why OKLab rather than sRGB or HSL: sRGB distance is not perceptual, so a fixed
 * hex step means a different visible step at every point on a ramp. That is
 * precisely how rev 7's mid stops ended up reading as mush. OKLab is close to
 * perceptually uniform, so Euclidean distance in it is a usable "how different
 * do these look" number, and OKLCH gives an honest lightness/chroma/hue frame to
 * construct in.
 */

/* ------------------------------------------------------------------ *
 * sRGB <-> linear
 * ------------------------------------------------------------------ */

export function hexToRgb255(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb255ToHex([r, g, b]) {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** sRGB channel (0–1, gamma encoded) → linear-light. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-light channel → sRGB (0–1, gamma encoded). */
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function hexToLinearRgb(hex) {
  return hexToRgb255(hex).map((c) => srgbToLinear(c / 255));
}

export function linearRgbToHex(lin) {
  return rgb255ToHex(lin.map((c) => linearToSrgb(c) * 255));
}

/** True when a linear-RGB triplet lands inside the sRGB gamut (small epsilon). */
export function inGamut(lin) {
  return lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
}

/* ------------------------------------------------------------------ *
 * OKLab / OKLCH (Björn Ottosson, 2020)
 * ------------------------------------------------------------------ */

export function linearRgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function oklabToLinearRgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklab(hex) {
  return linearRgbToOklab(hexToLinearRgb(hex));
}

/** OKLab → OKLCH; hue in degrees 0–360. */
export function oklabToOklch([L, a, b]) {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export function oklchToOklab([L, C, h]) {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

export function hexToOklch(hex) {
  return oklabToOklch(hexToOklab(hex));
}

/** OKLCH → hex, chroma reduced until the colour fits the sRGB gamut. */
export function oklchToHex([L, C, h]) {
  let lo = 0;
  let hi = C;
  if (inGamut(oklabToLinearRgb(oklchToOklab([L, C, h])))) {
    return linearRgbToHex(oklabToLinearRgb(oklchToOklab([L, C, h])).map(clamp01));
  }
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearRgb(oklchToOklab([L, mid, h])))) lo = mid;
    else hi = mid;
  }
  return linearRgbToHex(oklabToLinearRgb(oklchToOklab([L, lo, h])).map(clamp01));
}

function clamp01(c) {
  return Math.max(0, Math.min(1, c));
}

/** Largest in-gamut chroma at a given OKLCH lightness and hue. */
export function maxChroma(L, h) {
  let lo = 0;
  let hi = 0.45;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearRgb(oklchToOklab([L, mid, h])))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/* ------------------------------------------------------------------ *
 * Distance
 * ------------------------------------------------------------------ */

/**
 * Perceptual distance: Euclidean in OKLab, x100 so the numbers read like the
 * familiar CIE ΔE scale. This is the same unit the dataviz skill's validator
 * uses, which is why the thresholds in test-ramp-legibility.mjs are stated in it.
 */
export function deltaE(hexA, hexB) {
  const a = hexToOklab(hexA);
  const b = hexToOklab(hexB);
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ------------------------------------------------------------------ *
 * WCAG contrast (the basemap legibility floor)
 * ------------------------------------------------------------------ */

export function relativeLuminance(hex) {
  const [r, g, b] = hexToLinearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ *
 * Colour-vision deficiency simulation
 *
 * Machado, Oliveira & Fernandes (2009), severity 1.0, applied in LINEAR RGB
 * (the matrices are defined there; applying them to gamma-encoded values is a
 * common and silent mistake). Severity 1.0 is dichromacy — the hardest case,
 * and the one the dataviz skill's thresholds are calibrated against.
 * ------------------------------------------------------------------ */

const CVD_MATRIX = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export const CVD_TYPES = Object.keys(CVD_MATRIX);

/** Simulate `hex` as seen with the named dichromacy. Returns a hex. */
export function simulateCvd(hex, type) {
  const m = CVD_MATRIX[type];
  if (!m) throw new Error(`unknown CVD type: ${type}`);
  const lin = hexToLinearRgb(hex);
  const out = m.map((row) =>
    clamp01(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]),
  );
  return linearRgbToHex(out);
}

/* ------------------------------------------------------------------ *
 * Ramp sampling — the exact algorithm components/mapConfig.ts ships, so a
 * test can measure the colours the map will really paint at intermediate
 * scores rather than only at the declared stops.
 * ------------------------------------------------------------------ */

/**
 * Sample a 3-stop ramp at an arbitrary 0–100 value, interpolating in OKLab.
 * MUST stay identical to sampleRamp() in components/mapConfig.ts.
 */
export function sampleRampStops(stops, value) {
  const v = Math.max(0, Math.min(100, value));
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].at) {
      lo = stops[i - 1];
      hi = stops[i];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = (v - lo.at) / span;
  const a = hexToOklab(lo.hex);
  const b = hexToOklab(hi.hex);
  const mixed = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return linearRgbToHex(oklabToLinearRgb(mixed).map(clamp01));
}
