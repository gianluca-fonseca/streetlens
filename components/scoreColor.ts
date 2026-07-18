/*
 * Readable ramp ink (u33) — the map's score colours, made safe as PANEL TEXT.
 *
 * The detail panel must speak the map's colour language: a score's value should
 * carry the same hue the segment carries on the map, so Accessibility 87.5
 * visibly towers over Bike 16.67. But the sealed RAMP in components/mapConfig.ts
 * is tuned for LINES ON A BASEMAP, not for text on a panel surface, and several
 * of its stops are unusable as ink:
 *
 *   accessibility @100 = #00204D (deep Cividis blue) → 1.35:1 on dark #141414
 *   shade         @100 = #14532D (canopy green)      → 1.68:1 on dark #141414
 *   shade         @0   = #DDE3CE (pale bone)         → 1.34:1 on light #ffffff
 *
 * Painting those raw would fail WCAG AA outright in one theme or the other, and
 * accessibility is a hard constraint on this panel, not a preference.
 *
 * So this module derives ink from the ramp instead of replacing it. It samples
 * the SEALED ramp, converts to HSL, holds hue and saturation fixed — the colour
 * identity, which is what carries the meaning — and moves ONLY lightness until
 * the result clears AA against the theme's worst-case panel surface. A score
 * still reads as "the accessibility blue" or "the bike copper"; it is just
 * bright enough on near-black and dark enough on white to actually be read.
 *
 * What this module is NOT: it invents no score→colour semantics of its own. It
 * never mutates RAMP, never reorders stops, never changes which hue a lens owns.
 * Remove it and the map is unchanged. scripts/test-score-color.mjs asserts both
 * halves of that contract — AA compliance across every layer × every value, and
 * byte-identity of the ramp table itself.
 */

// Relative, not "@/components/mapConfig", on purpose: scripts/test-score-color.mjs
// compiles this file to CJS and requires it directly, and tsc does not rewrite
// path aliases on emit. mapConfig's own imports are all `import type`, so it
// erases to a dependency-free module and this require resolves under plain node.
import { sampleRamp, RAMP } from "./mapConfig";
import type { ScoreLayer } from "@/lib/segments";

/**
 * Worst-case surfaces the panel paints score ink onto.
 *
 * In BOTH themes the worst case is the background nearest the ink's own
 * luminance, because that is where the gap is narrowest — so light ink (dark
 * theme) is governed by the LIGHTEST panel surface, and dark ink (light theme)
 * by the DARKEST one.
 *
 * The light value is easy to get backwards (white is the "extreme" surface, so
 * it looks like the hard case) and #ffffff was in fact wrong here first: it let
 * 86 layer/value pairs through that then failed on #f1f1f1. Light cards sit on
 * #ffffff / #f1f1f1, so #f1f1f1 governs.
 *
 * SURFACE_DARK tracks the panel's DARK ELEVATION LADDER, not the global dark
 * tokens. panel.module.css lifts the whole panel off the near-black page ground
 * (#0a0a0a) onto ground #141414 → recessed plate #1a1a1a → elevated shell and
 * canonical card #212121 (see the elevation block there for why), so the
 * lightest surface score ink is ever painted on is #212121 and that is what
 * governs. Fitting to the old #141414 would measure every ink against a
 * background it is no longer painted on, which is exactly the flavour of
 * mistake the light side already made once.
 */
export const SURFACE_LIGHT = "#f1f1f1";
export const SURFACE_DARK = "#212121";

/** WCAG 2.1 AA for normal-size body text. The hard floor, in both themes. */
export const AA_TEXT = 4.5;

/**
 * The DARK-theme target: AAA-for-body, not AA.
 *
 * AA is a floor, not a goal, and on a phone the difference is not academic. Ink
 * fitted to exactly 4.5:1 on near-black measures compliant and still reads
 * muddy outdoors or at low display brightness — which is what the panel shipped
 * with, and what "not able to see well" was reporting. Targeting 7:1 costs
 * nothing structural (the derivation only moves lightness, so hue identity is
 * untouched) and buys ink that stays legible when the screen is dimmed.
 *
 * Light theme keeps AA_TEXT: dark ink on a bright surface was never the
 * complaint, and raising it there would only push the ramp toward black and
 * cost the map-colour reading that the whole module exists to preserve.
 */
export const DARK_INK_TARGET = 7;

/** A colour resolved for both themes; the CSS module picks one via `html.dark`. */
export type ThemedInk = Readonly<{ light: string; dark: string }>;

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** WCAG relative luminance (sRGB → linear, Rec. 709 weights). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours; 1 (identical) to 21 (b/w). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((c) => c / 255) as unknown as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hue(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) {
    const v = l * 255;
    return rgbToHex([v, v, v]);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex([
    hue(p, q, h + 1 / 3) * 255,
    hue(p, q, h) * 255,
    hue(p, q, h - 1 / 3) * 255,
  ]);
}

/**
 * Nudge `hex` along its own lightness axis until it clears `target` contrast
 * against `bg`, and no further — the minimum move that satisfies the rule, so
 * the colour stays as close to the map's as accessibility permits.
 *
 * Direction is set by the background: darken against a light surface, lighten
 * against a dark one. A binary search on lightness converges in ~24 steps and
 * always terminates, because the extreme (pure black on #f1f1f1, pure white on
 * #212121) clears both the AA floor and the 7:1 dark target by a wide margin —
 * 18.1:1 and 16.1:1 respectively — so a `pass` bound always exists.
 */
export function readableInk(hex: string, bg: string, target = AA_TEXT): string {
  if (contrastRatio(hex, bg) >= target) return hex;

  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const darken = relativeLuminance(bg) > 0.18;

  // Invariant: `fail` never clears the target, `pass` always does. The search
  // walks `pass` back toward the original colour without breaking that.
  let fail = l;
  let pass = darken ? 0 : 1;
  for (let i = 0; i < 24; i++) {
    const mid = (fail + pass) / 2;
    if (contrastRatio(hslToHex(h, s, mid), bg) >= target) pass = mid;
    else fail = mid;
  }
  return hslToHex(h, s, pass);
}

/**
 * The panel ink for `value` on `layer`, in both themes.
 *
 * Used for the score numeral AND its meter fill. One colour for both is
 * deliberate: it keeps numeral and bar unmistakably the same reading, and AA
 * text contrast (4.5:1) comfortably exceeds the 3:1 WCAG asks of a graphical
 * object, so the bar is covered by the stricter of the two rules.
 */
export function rampInk(layer: ScoreLayer, value: number): ThemedInk {
  const base = sampleRamp(layer, value);
  return {
    light: readableInk(base, SURFACE_LIGHT),
    dark: readableInk(base, SURFACE_DARK, DARK_INK_TARGET),
  };
}

/**
 * CSS custom properties for a score, consumed by panel.module.css, which picks
 * `--sd-ink-dark` under `html.dark` and `--sd-ink` otherwise. Two properties
 * rather than one resolved value because the theme is a CLASS on <html>, not a
 * media query: an inline style cannot branch on it, but CSS can.
 */
export function rampInkVars(
  layer: ScoreLayer,
  value: number,
): Record<"--sd-ink" | "--sd-ink-dark", string> {
  const ink = rampInk(layer, value);
  return { "--sd-ink": ink.light, "--sd-ink-dark": ink.dark };
}

/** Meter width for a 0–100 score, clamped, as a CSS percentage string. */
export function meterWidth(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, value))}%`;
}

/** Re-exported for the seal test only; never mutate. */
export { RAMP };
