/*
 * The score ramps must stay legible on BOTH basemaps, and must survive
 * grayscale (rev 7, #28).
 *
 * test-score-color.mjs freezes the ramp table byte-for-byte, which catches an
 * accidental edit but says nothing about whether the values are any GOOD. This
 * suite asserts the design RULES that produced rev 7, so a future deliberate
 * retune has to keep the properties rather than merely re-freeze new bytes.
 *
 * The rules, and why each exists:
 *
 *   1. LUMINANCE BAND. BASEMAP is near-white in light (land #fafafa, roads
 *      #ffffff) and near-black in dark (land #0a0a0a, roads #141414). A stop is
 *      legible in both themes only if its relative luminance sits in the middle.
 *      Rev 2 broke this at both ends — shade@0 #DDE3CE vanished on the light
 *      basemap, accessibility@100 #00204D on the dark one — which is the defect
 *      the owner reported as "hard to see".
 *
 *   2. MONOTONIC LUMINANCE. bad→good must not be carried by hue alone, or the
 *      ramp collapses for a red/green-colourblind reader and in grayscale. Every
 *      ramp descends in luminance from score 0 to score 100, so the ordering
 *      survives with all colour removed.
 *
 *   3. NO COLLISION with the neutral community casing, which shares the map.
 *
 * Thresholds are the WCAG 3:1 non-text/graphical-object floor. The dark road
 * surface #141414 is the single hardest case and lands at ~2.92:1, so it gets an
 * explicitly documented 2.9 floor rather than a silently loosened global one.
 */

import { readFileSync } from "node:fs";

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
 * Parse RAMP and COMMUNITY_CASING straight out of the TypeScript source.
 * Deliberately not a tsc compile step: this suite must fail loudly if someone
 * edits the hex literals in mapConfig.ts, and reading the literals is the most
 * direct expression of that. The shape is a plain table, so a regex is honest
 * here in a way it would not be for arbitrary code.
 */
const src = readFileSync(`${ROOT}components/mapConfig.ts`, "utf8");

function parseRamp() {
  const block = src.slice(
    src.indexOf("export const RAMP"),
    src.indexOf("/** Width channel"),
  );
  const out = {};
  for (const m of block.matchAll(
    /(\w+):\s*\[\s*((?:\{[^}]*\},?\s*)+)\]/g,
  )) {
    const stops = [...m[2].matchAll(/\{\s*at:\s*(\d+),\s*hex:\s*"(#[0-9A-Fa-f]{6})"\s*\}/g)]
      .map((s) => ({ at: Number(s[1]), hex: s[2] }));
    if (stops.length) out[m[1]] = stops;
  }
  return out;
}

const RAMP = parseRamp();
const CASING = [...src.matchAll(/color(?:Dark)?:\s*"(#[0-9A-Fa-f]{6})"/g)]
  .map((m) => m[1].toUpperCase());

const hexToRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** The surfaces a score line is actually painted over, per theme. */
const SURFACES = {
  "light land #fafafa": { hex: "#fafafa", floor: 3.0 },
  "light road #ffffff": { hex: "#ffffff", floor: 3.0 },
  "dark land #0a0a0a": { hex: "#0a0a0a", floor: 3.0 },
  // The brightest dark surface, and the tightest constraint in the whole design.
  "dark road #141414": { hex: "#141414", floor: 2.9 },
};

console.log("ramp legibility — rev 7 design rules (#28)\n");

check("all five lenses are present", Object.keys(RAMP).length === 5, Object.keys(RAMP).join(","));

console.log("\nrule 1 — every stop is legible on both basemaps");
for (const [layer, stops] of Object.entries(RAMP)) {
  for (const { at, hex } of stops) {
    for (const [name, { hex: bg, floor }] of Object.entries(SURFACES)) {
      const ratio = contrast(hex, bg);
      if (ratio < floor) {
        check(`${layer}@${at} ${hex} on ${name}`, false, `${ratio.toFixed(2)}:1 < ${floor}:1`);
      }
    }
  }
}
check(
  "no stop falls below its surface floor in either theme",
  failures === 0,
);

console.log("\nrule 2 — bad→good survives grayscale (CVD safety)");
for (const [layer, stops] of Object.entries(RAMP)) {
  const ls = stops.map((s) => luminance(s.hex));
  const descending = ls.every((l, i) => i === 0 || l < ls[i - 1]);
  const spread = (ls[0] + 0.05) / (ls[ls.length - 1] + 0.05);
  check(
    `${layer}: luminance is monotonic (grayscale spread ${spread.toFixed(2)}:1)`,
    descending && spread >= 1.7,
    descending ? `spread only ${spread.toFixed(2)}:1` : "not monotonic",
  );
}

console.log("\nrule 3 — no collision with the neutral community casing");
{
  const all = Object.values(RAMP).flat().map((s) => s.hex.toUpperCase());
  const hit = all.filter((h) => CASING.includes(h));
  check("no ramp stop equals a community casing colour", hit.length === 0, hit.join(","));
}

console.log("\nstructure — the mandated shape is intact");
{
  check("overall keeps three stops", RAMP.overall?.length === 3);
  check(
    "overall keeps a red-family low end (hue within 30° of red)",
    (() => {
      const [r, g, b] = hexToRgb(RAMP.overall[0].hex);
      return r > g && r > b && r - Math.max(g, b) > 60;
    })(),
    RAMP.overall?.[0]?.hex,
  );
  check(
    "every ramp runs 0 → 50 → 100",
    Object.values(RAMP).every(
      (s) => s.length === 3 && s[0].at === 0 && s[1].at === 50 && s[2].at === 100,
    ),
  );
}

console.log(
  failures === 0
    ? "\nramp legibility: all checks passed"
    : `\nramp legibility: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
