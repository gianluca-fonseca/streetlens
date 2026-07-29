/*
 * The score ramps must be READABLE, not merely present (rev 8).
 *
 * test-score-color.mjs freezes the ramp table byte-for-byte, which catches an
 * accidental edit but says nothing about whether the values are any GOOD. This
 * suite asserts the design RULES that produced rev 8, so a future deliberate
 * retune has to keep the properties rather than merely re-freeze new bytes.
 *
 * Rev 7's version of this file asserted a NARROW luminance band, because one
 * table had to sit on both basemaps at once. That band was the bug: measured on
 * the shipped rev-7 table, adjacent quartiles were 3.8–6.1 ΔE apart, which is
 * why "it is hard to see what is excellent and what is poor" was a fair report.
 * Rev 8 splits the table per basemap and spends the freed lightness on
 * separating scores, so the rules here changed shape: the contrast floor is now
 * per theme, and DISCRIMINABILITY is asserted rather than assumed.
 *
 * The rules, and why each exists:
 *
 *   1. CONTRAST, PER THEME. Every stop clears the WCAG 3:1 graphical-object
 *      floor against the land AND the road of the basemap it is painted on.
 *      This is what keeps "quieter" from becoming "invisible" at the poor end.
 *
 *   2. DISCRIMINABILITY. Adjacent quartiles must be far enough apart to read as
 *      different colours, under normal vision and under dichromacy, and the
 *      worst quartile must be far from the best. The thresholds and the one
 *      documented exception are stated at DE_* below.
 *
 *   3. MONOTONIC LIGHTNESS, INCLUDING UNDER CVD. Worst→good must not be carried
 *      by hue alone. Every ramp's simulated protanope and deuteranope luminance
 *      is strictly ordered, so the reading survives with colour removed.
 *
 *   4. DIRECTION AGREEMENT. Width grows with the score, matching the hero
 *      relief's height. This is the rule rev 7 broke in the other direction.
 *
 *   5. NO COLLISION with the neutral community casing, which shares the map.
 *
 * The measurements themselves come from scripts/lib/color-lab.mjs, which
 * scripts/design-ramps.mjs also uses to SOLVE the table — so the tool that
 * proposes a ramp and the test that guards it cannot disagree about the maths.
 */

import { readFileSync } from "node:fs";
import {
  contrast,
  deltaE,
  hexToOklch,
  relativeLuminance,
  sampleRampStops,
  simulateCvd,
} from "./lib/color-lab.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/*
 * Parse RAMP, the width constants, and COMMUNITY_CASING straight out of the
 * TypeScript source. Deliberately not a tsc compile step: this suite must fail
 * loudly if someone edits the literals in mapConfig.ts, and reading them is the
 * most direct expression of that. The shape is a plain table, so a regex is
 * honest here in a way it would not be for arbitrary code.
 */
const src = readFileSync(`${ROOT}components/mapConfig.ts`, "utf8");

function parseStops(block) {
  return [
    ...block.matchAll(/\{\s*at:\s*(\d+),\s*hex:\s*"(#[0-9A-Fa-f]{6})"\s*\}/g),
  ].map((s) => ({ at: Number(s[1]), hex: s[2] }));
}

function parseRamp() {
  const block = src.slice(
    src.indexOf("export const RAMP"),
    src.indexOf("Width channel"),
  );
  const out = {};
  // Each lens is `name: { light: [...], dark: [...] },` — match the lens header
  // then take everything up to the next lens (or the end of the table).
  const lensRe = /^  (\w+): \{$/gm;
  const heads = [...block.matchAll(lensRe)];
  heads.forEach((m, i) => {
    const body = block.slice(m.index, heads[i + 1]?.index ?? block.length);
    const light = body.slice(body.indexOf("light: ["), body.indexOf("dark: ["));
    const dark = body.slice(body.indexOf("dark: ["));
    out[m[1]] = { light: parseStops(light), dark: parseStops(dark) };
  });
  return out;
}

const RAMP = parseRamp();
const CASING = [...src.matchAll(/color(?:Dark)?:\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) =>
  m[1].toUpperCase(),
);
const WIDTH_AT_0 = Number(/const WIDTH_AT_0 = ([\d.]+);/.exec(src)?.[1]);
const WIDTH_AT_100 = Number(/const WIDTH_AT_100 = ([\d.]+);/.exec(src)?.[1]);

/** The surfaces a score line is actually painted over, per theme. */
const SURFACES = {
  light: { "land #fafafa": "#fafafa", "road #ffffff": "#ffffff" },
  dark: { "land #0a0a0a": "#0a0a0a", "road #141414": "#141414" },
};
const CONTRAST_FLOOR = 3;

/*
 * Thresholds, in Euclidean OKLab ×100 (the dataviz skill's ΔE unit).
 *
 * Adjacent quartiles are the FINE reading and get the skill's categorical
 * numbers: the 8 target under normal vision, and its 6 floor under simulated
 * dichromacy — the floor is legal only alongside secondary encoding, which here
 * genuinely ships (line width, the hero's extrusion height, the binned legend).
 *
 * The pair that actually decides the product is the 25th vs the 75th percentile:
 * "at a glance, without the legend, can you separate the worst quartile from the
 * best." That is the squint test, so it gets a much higher bar and is held under
 * simulation too, where the adjacent numbers alone would hide a collapse.
 */
const DE_ADJACENT_NORMAL = 8;
const DE_ADJACENT_CVD = 6;
const DE_Q25_Q75 = 15;
const DE_Q25_Q75_CVD = 12;

/*
 * `overall` is the red-green traffic light, and protanopia is where it pays for
 * that. A protanope sees almost no luminance in long-wavelength light, so coral
 * and rust converge no matter which lightnesses they are given, and on the light
 * basemap the rust-to-dark-green step converges too. There is no re-picking that
 * fixes it inside the "red low end" mandate, and inverting the mandate to fix it
 * would cost every full-colour reader the one ramp they already understand.
 *
 * So this is a KNOWN, BOUNDED collapse rather than an oversight: the numbers are
 * pinned here so they cannot quietly get worse, the ramp still has to clear the
 * squint test under simulation, rule 3 still requires monotonic simulated
 * luminance (so the ORDER always survives), and the redundant channels — width,
 * the hero's height, the binned legend — are what a protanope actually reads.
 */
const DE_ADJACENT_CVD_OVERALL = 4.5;
const DE_Q25_Q75_CVD_OVERALL = 9;

const THEMES = ["light", "dark"];
const QUARTILES = [0, 25, 50, 75, 100];

console.log("ramp legibility — rev 8 design rules\n");

check("all five lenses are present", Object.keys(RAMP).length === 5, Object.keys(RAMP).join(","));
check(
  "every lens ships a light half and a dark half, five stops each",
  Object.values(RAMP).every((lens) =>
    THEMES.every(
      (t) =>
        lens[t]?.length === QUARTILES.length &&
        lens[t].every((s, i) => s.at === QUARTILES[i]),
    ),
  ),
);

console.log("\nrule 1 — every stop clears 3:1 on its OWN basemap");
{
  let worst = { ratio: Infinity };
  for (const [layer, lens] of Object.entries(RAMP)) {
    for (const theme of THEMES) {
      for (const { at, hex } of lens[theme]) {
        for (const [name, bg] of Object.entries(SURFACES[theme])) {
          const ratio = contrast(hex, bg);
          if (ratio < worst.ratio) worst = { ratio, where: `${layer}.${theme}@${at} on ${name}` };
          if (ratio < CONTRAST_FLOOR) {
            check(`${layer}.${theme}@${at} ${hex} on ${name}`, false, `${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
  }
  check(
    `no stop falls below ${CONTRAST_FLOOR}:1 (worst ${worst.ratio.toFixed(2)}:1 — ${worst.where})`,
    worst.ratio >= CONTRAST_FLOOR,
  );
}

console.log("\nrule 2 — adjacent quartiles are actually distinguishable");
for (const [layer, lens] of Object.entries(RAMP)) {
  for (const theme of THEMES) {
    const stops = lens[theme];
    const at = (v) => sampleRampStops(stops, v);
    let worstNormal = Infinity;
    let worstCvd = Infinity;
    let where = "";
    for (let i = 1; i < QUARTILES.length; i++) {
      const a = at(QUARTILES[i - 1]);
      const b = at(QUARTILES[i]);
      const n = deltaE(a, b);
      if (n < worstNormal) {
        worstNormal = n;
        where = `${QUARTILES[i - 1]}→${QUARTILES[i]}`;
      }
      for (const type of ["deutan", "protan"]) {
        worstCvd = Math.min(worstCvd, deltaE(simulateCvd(a, type), simulateCvd(b, type)));
      }
    }
    const q = deltaE(at(25), at(75));
    const qCvd = Math.min(
      ...["deutan", "protan"].map((t) =>
        deltaE(simulateCvd(at(25), t), simulateCvd(at(75), t)),
      ),
    );
    const isOverall = layer === "overall";
    const qFloor = isOverall ? DE_Q25_Q75_CVD_OVERALL : DE_Q25_Q75_CVD;
    const cvdFloor = isOverall ? DE_ADJACENT_CVD_OVERALL : DE_ADJACENT_CVD;
    check(
      `${layer}.${theme}: adjacent ΔE ≥ ${DE_ADJACENT_NORMAL} ` +
        `(worst ${worstNormal.toFixed(1)} at ${where}), ≥ ${cvdFloor} simulated ` +
        `(worst ${worstCvd.toFixed(1)})`,
      worstNormal >= DE_ADJACENT_NORMAL && worstCvd >= cvdFloor,
    );
    check(
      `${layer}.${theme}: SQUINT TEST 25↔75 ΔE ${q.toFixed(1)} normal / ` +
        `${qCvd.toFixed(1)} simulated (floors ${DE_Q25_Q75} / ${qFloor})`,
      q >= DE_Q25_Q75 && qCvd >= qFloor,
    );
  }
}

console.log("\nrule 3 — worst→best survives with colour removed (CVD safety)");
for (const [layer, lens] of Object.entries(RAMP)) {
  for (const theme of THEMES) {
    const stops = lens[theme];
    // Light basemap: better is darker. Dark basemap: better is brighter. Either
    // way the sequence must be STRICTLY ordered, never flat and never folded.
    const sign = theme === "light" ? -1 : 1;
    for (const [label, transform] of [
      ["plain", (h) => h],
      ["deutan", (h) => simulateCvd(h, "deutan")],
      ["protan", (h) => simulateCvd(h, "protan")],
    ]) {
      const ys = stops.map((s) => relativeLuminance(transform(s.hex)));
      const ordered = ys.every((y, i) => i === 0 || sign * (y - ys[i - 1]) > 0);
      check(
        `${layer}.${theme}: luminance is monotonic under ${label}`,
        ordered,
        ys.map((y) => y.toFixed(3)).join(" → "),
      );
    }
    // And the ends must be far enough apart to be a spread, not a nuance.
    const ends = stops.map((s) => relativeLuminance(s.hex));
    const spread =
      (Math.max(...ends) + 0.05) / (Math.min(...ends) + 0.05);
    check(
      `${layer}.${theme}: grayscale spread ${spread.toFixed(2)}:1 ≥ 3.5:1`,
      spread >= 3.5,
    );
  }
}

console.log("\nrule 4 — every channel points the same way (higher score = more)");
{
  check(
    `line width grows with the score (${WIDTH_AT_0} → ${WIDTH_AT_100} px)`,
    Number.isFinite(WIDTH_AT_0) && Number.isFinite(WIDTH_AT_100) && WIDTH_AT_100 > WIDTH_AT_0,
    `${WIDTH_AT_0} → ${WIDTH_AT_100}`,
  );
  check(
    "the width range is wide enough to read (≥ 3x, and ≥ 4px of absolute range)",
    WIDTH_AT_100 / WIDTH_AT_0 >= 3 && WIDTH_AT_100 - WIDTH_AT_0 >= 4,
    `${(WIDTH_AT_100 / WIDTH_AT_0).toFixed(1)}x, ${(WIDTH_AT_100 - WIDTH_AT_0).toFixed(1)}px`,
  );
  // The score relief is the third channel and must not disagree with the other
  // two. Read from its own source rather than duplicating the constants.
  const relief = readFileSync(`${ROOT}components/scoreRelief.ts`, "utf8");
  const h0 = Number(/RELIEF_HEIGHT_AT_0 = ([\d.]+);/.exec(relief)?.[1]);
  const h100 = Number(/RELIEF_HEIGHT_AT_100 = ([\d.]+);/.exec(relief)?.[1]);
  check(
    `score relief height grows with the score too (${h0} → ${h100} m)`,
    Number.isFinite(h0) && Number.isFinite(h100) && h100 > h0,
  );
}

console.log("\nrule 5 — no collision with the neutral community casing");
{
  const all = Object.values(RAMP)
    .flatMap((lens) => THEMES.flatMap((t) => lens[t]))
    .map((s) => s.hex.toUpperCase());
  const hit = all.filter((h) => CASING.includes(h));
  check("no ramp stop equals a community casing colour", hit.length === 0, hit.join(","));
}

console.log("\nstructure — the mandated lens identities are intact");
{
  check(
    "overall keeps a red-family low end in BOTH themes (the design mandate)",
    THEMES.every((t) => {
      const [, , h] = hexToOklch(RAMP.overall[t][0].hex);
      return h < 45 || h > 345;
    }),
    THEMES.map((t) => `${t} ${RAMP.overall[t][0].hex}`).join(" "),
  );
  check(
    "bike stays magenta and clears accessibility's violet by ≥ 15° of hue",
    THEMES.every((t) =>
      RAMP.bike[t].every((s, i) => {
        const hb = hexToOklch(s.hex)[2];
        const ha = hexToOklch(RAMP.accessibility[t][i].hex)[2];
        const d = Math.abs(((hb - ha + 540) % 360) - 180);
        return 180 - d >= 15;
      }),
    ),
  );
  check(
    "drainage stays in the cool water register (hue 190–260) throughout",
    THEMES.every((t) =>
      RAMP.drainage[t].every((s) => {
        const h = hexToOklch(s.hex)[2];
        return h >= 190 && h <= 260;
      }),
    ),
  );
  check(
    "shade stays green (hue 110–170) throughout",
    THEMES.every((t) =>
      RAMP.shade[t].every((s) => {
        const h = hexToOklch(s.hex)[2];
        return h >= 110 && h <= 170;
      }),
    ),
  );
}

console.log(
  failures === 0
    ? "\nramp legibility: all checks passed"
    : `\nramp legibility: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
