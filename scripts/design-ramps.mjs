#!/usr/bin/env node
/*
 * design-ramps.mjs — the tool that SOLVES the score ramp table (rev 8).
 *
 * Not a test (it is not `test-*.mjs`, so `npm test` does not run it). It is the
 * derivation, kept in the repo so the table in components/mapConfig.ts can be
 * regenerated and audited rather than re-picked by eye. Run:
 *
 *   node scripts/design-ramps.mjs            # print the table + the measurements
 *   node scripts/design-ramps.mjs --ts       # print the TS literal to paste
 *
 * The constraint set it solves, per lens per theme:
 *
 *   1. Every stop clears 3:1 against the basemap it is actually painted on IN
 *      THAT THEME (light: #fafafa land / #ffffff road; dark: #0a0a0a land /
 *      #141414 road). Rev 7 asked every stop to clear BOTH, which pinned the
 *      whole table into a relative-luminance band of 0.118–0.278 and left
 *      adjacent quartiles 3.8–6.1 ΔE apart. That band is the reason the spectrum
 *      was unreadable, and splitting the table per theme is what unlocks it.
 *   2. Lightness runs monotonically with the score, in the direction the theme
 *      allows: on the light basemap a better street is DARKER, on the dark
 *      basemap a better street is BRIGHTER. Both say "more presence = better",
 *      which is the same rule width and height now follow.
 *   3. Each lens keeps its hue family (the identity), including overall's
 *      red-amber-emerald traffic light and bike's magenta.
 *   4. Chroma is pushed to ~95% of the sRGB gamut at each stop's lightness, so
 *      the ends stay vivid instead of drifting to gray.
 */

import {
  contrast,
  deltaE,
  hexToOklch,
  maxChroma,
  oklchToHex,
  relativeLuminance,
  sampleRampStops,
  simulateCvd,
} from "./lib/color-lab.mjs";

/* ---------------------------------------------------------------- *
 * The constraint set
 * ---------------------------------------------------------------- */

/** The surfaces a score line is painted over, per theme, worst case first. */
export const SURFACES = {
  light: ["#ffffff", "#fafafa"], // roads are the brightest, so the tightest
  dark: ["#0a0a0a", "#141414"], // roads are the least dark, so the tightest
};

/** WCAG non-text / graphical-object floor, with a hair of margin for rounding. */
const CONTRAST_FLOOR = 3.05;

/** Fraction of the in-gamut chroma each stop takes. Below 1.0 so a rounding
 *  wobble in either direction cannot push a stop outside sRGB. */
const CHROMA_FRACTION = 0.95;

/** How dark the light-theme "best" end is allowed to go before hue stops
 *  reading as a hue at all. Below ~0.30 OKLCH L a saturated indigo is a bruise. */
const LIGHT_DARK_FLOOR = 0.3;

/** How bright the dark-theme "best" end goes. Above ~0.86 most hues run out of
 *  gamut chroma and the stop reads as tinted white. */
const DARK_BRIGHT_CEIL = 0.855;

/** The ramp is declared at the quartiles the acceptance test measures, so the
 *  numbers in the evidence table are the ramp's own stops, not interpolations. */
const STOPS_AT = [0, 25, 50, 75, 100];

/**
 * Hue journey per lens, in OKLCH degrees, one entry per stop.
 *
 * The endpoints are the hues the SHIPPED rev-7 stops already had (measured off
 * the old table, not invented), so every lens identity carries over exactly:
 *   overall  27.4 → … → 158    the traffic light (the only multi-hue ramp)
 *   access. 319.1 → … → 291.6  orchid → electric indigo
 *   drainage 208.5 → … → 249.0 cyan → azure, the water register
 *   shade    126.9 → … → 155.0 dry lime → canopy
 *   bike     356.7 → … → 337.8 pink → deep magenta
 *
 * overall reaches green by the 75th percentile rather than drifting through
 * yellow: on a lightness-ordered ramp a yellow stop is an olive stop, and the
 * "nearly excellent" quartile has to look like the good end, not like mud.
 */
const HUES = {
  overall: [27.4, 38.0, 50.0, 155.0, 166.0],
  accessibility: [319.1, 312.2, 305.4, 298.5, 291.6],
  drainage: [208.5, 218.6, 228.8, 238.9, 249.0],
  shade: [126.9, 133.4, 139.9, 146.5, 153.0],
  bike: [356.7, 352.0, 347.3, 342.5, 337.8],
};

const LAYERS = Object.keys(HUES);

/* ---------------------------------------------------------------- *
 * The solver
 * ---------------------------------------------------------------- */

function stopHex(L, h) {
  return oklchToHex([L, maxChroma(L, h) * CHROMA_FRACTION, h]);
}

function worstContrast(hex, theme) {
  return Math.min(...SURFACES[theme].map((bg) => contrast(hex, bg)));
}

/**
 * The extreme lightness this hue can reach and still clear the floor against
 * its theme's basemap. Light theme searches upward (how light may the quiet end
 * be); dark theme searches downward (how dark may the quiet end be).
 */
function quietEndLightness(h, theme) {
  const lightTheme = theme === "light";
  // `pass` always clears the floor, `fail` never does; walk pass toward fail.
  let pass = lightTheme ? 0.2 : 0.95;
  let fail = lightTheme ? 0.95 : 0.2;
  for (let i = 0; i < 40; i++) {
    const mid = (pass + fail) / 2;
    if (worstContrast(stopHex(mid, h), theme) >= CONTRAST_FLOOR) pass = mid;
    else fail = mid;
  }
  return pass;
}

/** Solve one lens's stops for one theme: even lightness steps, max chroma. */
function solveLens(layer, theme) {
  const hues = HUES[layer];
  const quiet = quietEndLightness(hues[0], theme);
  const loud = theme === "light" ? LIGHT_DARK_FLOOR : DARK_BRIGHT_CEIL;
  const n = STOPS_AT.length - 1;
  return STOPS_AT.map((at, i) => {
    const L = quiet + ((loud - quiet) * i) / n;
    return { at, hex: stopHex(L, hues[i]).toUpperCase() };
  });
}

export function solveRamp() {
  const out = {};
  for (const layer of LAYERS) {
    out[layer] = { light: solveLens(layer, "light"), dark: solveLens(layer, "dark") };
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * Reporting
 * ---------------------------------------------------------------- */

const QUANTILES = [0, 25, 50, 75, 100];

export function measure(stops, theme) {
  const samples = QUANTILES.map((v) => ({ v, hex: sampleRampStops(stops, v) }));
  const adjacent = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].hex;
    const b = samples[i].hex;
    adjacent.push({
      pair: `${samples[i - 1].v}→${samples[i].v}`,
      normal: deltaE(a, b),
      deutan: deltaE(simulateCvd(a, "deutan"), simulateCvd(b, "deutan")),
      protan: deltaE(simulateCvd(a, "protan"), simulateCvd(b, "protan")),
    });
  }
  return {
    samples: samples.map((s) => ({
      ...s,
      oklch: hexToOklch(s.hex),
      Y: relativeLuminance(s.hex),
      contrast: Object.fromEntries(
        SURFACES[theme].map((bg) => [bg, contrast(s.hex, bg)]),
      ),
    })),
    adjacent,
    endToEnd: deltaE(samples[0].hex, samples[samples.length - 1].hex),
  };
}

function main() {
  const ramp = solveRamp();
  if (process.argv.includes("--ts")) {
    for (const layer of LAYERS) {
      for (const theme of ["light", "dark"]) {
        const line = ramp[layer][theme]
          .map((s) => `{ at: ${s.at}, hex: "${s.hex}" }`)
          .join(", ");
        console.log(`${layer}.${theme}: [${line}],`);
      }
    }
    return;
  }

  for (const layer of LAYERS) {
    for (const theme of ["light", "dark"]) {
      const stops = ramp[layer][theme];
      const m = measure(stops, theme);
      console.log(`\n${layer} / ${theme}`);
      for (const s of m.samples) {
        const [L, C, h] = s.oklch;
        const cs = Object.entries(s.contrast)
          .map(([bg, r]) => `${bg} ${r.toFixed(2)}:1`)
          .join("  ");
        console.log(
          `  ${String(s.v).padStart(3)}  ${s.hex}  L ${L.toFixed(3)} C ${C.toFixed(
            3,
          )} h ${h.toFixed(1)}  Y ${s.Y.toFixed(4)}  ${cs}`,
        );
      }
      console.log(
        `        ΔE  ${m.adjacent
          .map(
            (a) =>
              `${a.pair} ${a.normal.toFixed(1)}/${a.deutan.toFixed(
                1,
              )}/${a.protan.toFixed(1)}`,
          )
          .join("   ")}   end-to-end ${m.endToEnd.toFixed(1)}`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
