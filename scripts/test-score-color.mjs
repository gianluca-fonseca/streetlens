#!/usr/bin/env node
/**
 * test-score-color.mjs (u33)
 *
 * Locks the two halves of the panel's colour contract, which pull in opposite
 * directions and are exactly the pair a future edit is likely to break.
 *
 *  1. THE RAMP IS SEALED. components/scoreColor.ts exists to make the map's
 *     score colours usable as panel text. The obvious way to "fix" a low-
 *     contrast score would be to lighten a ramp stop — which would silently
 *     change what every street on the map looks like. So the ramp table is
 *     asserted against a frozen snapshot, stop for stop.
 *
 *  2. THE INK CLEARS AA. Every layer, every value 0–100, both themes, against
 *     the worst-case panel surface. This is the assertion that makes rule 1
 *     survivable: you cannot be tempted to touch the ramp if the derived ink is
 *     provably readable without it.
 *
 * Plus the properties that make the derivation trustworthy rather than merely
 * compliant: hue is preserved (an accessibility score still reads blue, a bike
 * score still reads copper), a colour that already passes is returned
 * untouched, and the adjustment is the MINIMUM one that clears the bar.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-score-color");
// The temp project lives at ROOT so its relative `extends` and `paths` resolve
// exactly as the real tsconfig does — scoreColor.ts imports a type across the
// "@/" alias, and a detached tsconfig would fail to resolve it.
const TS_PROJECT = path.join(ROOT, "tsconfig.test-score-color.json");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * The sealed ramp, frozen here as an independent copy. Deliberately NOT
 * imported from the module under test: a snapshot that reads from the thing it
 * guards would pass no matter what anyone did to it.
 */
const SEALED_RAMP = {
  overall: [
    { at: 0, hex: "#C0472B" },
    { at: 50, hex: "#E8B84B" },
    { at: 100, hex: "#0E7C66" },
  ],
  accessibility: [
    { at: 0, hex: "#FFE945" },
    { at: 50, hex: "#7C7B78" },
    { at: 100, hex: "#00204D" },
  ],
  drainage: [
    { at: 0, hex: "#C7C13B" },
    { at: 50, hex: "#4CA377" },
    { at: 100, hex: "#21808C" },
  ],
  shade: [
    { at: 0, hex: "#DDE3CE" },
    { at: 50, hex: "#6E9463" },
    { at: 100, hex: "#14532D" },
  ],
  bike: [
    { at: 0, hex: "#E8D9C4" },
    { at: 50, hex: "#C88C5E" },
    { at: 100, hex: "#8A4B2D" },
  ],
};

const LAYERS = Object.keys(SEALED_RAMP);

/** Chroma (max-min channel, 0-255) — how much colour a hex actually carries.
 *  Used to weight the hue check, so a near-grey's numerically wild hue angle is
 *  scaled down to the visual nothing that it is. */
function chromaOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(...c) - Math.min(...c);
}

/** Independent hue extraction, so "hue preserved" is not checked with the
 *  module's own arithmetic. Returns degrees, or null for a grey. */
function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return null;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

function hueDelta(a, b) {
  if (a === null || b === null) return 0;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  writeFileSync(
    TS_PROJECT,
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          noEmit: false,
          outDir: path.relative(ROOT, BUILD_DIR),
          module: "commonjs",
          moduleResolution: "node",
          target: "es2019",
          declaration: false,
          incremental: false,
        },
        // `include` MUST be cleared: `extends` inherits the base config's
        // "**/*.ts" glob, and `files` does not override it — without this the
        // compile drags in the whole app (and fails on unrelated modules).
        include: [],
        files: ["components/scoreColor.ts", "components/mapConfig.ts"],
      },
      null,
      2,
    ) + "\n",
  );

  try {
    execFileSync("npx", ["tsc", "--project", path.basename(TS_PROJECT)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // mapConfig imports only types, so it emits with no requires and
    // scoreColor's relative `./mapConfig` resolves under plain node.
    const S = require(path.join(BUILD_DIR, "components", "scoreColor.js"));
    const M = require(path.join(BUILD_DIR, "components", "mapConfig.js"));

    // 1. The ramp is untouched, stop for stop.
    {
      const same = JSON.stringify(M.RAMP) === JSON.stringify(SEALED_RAMP);
      check(
        "the sealed RAMP is byte-identical (scoreColor derives, never modifies)",
        same,
        same ? "" : JSON.stringify(M.RAMP),
      );
    }

    // 2. Known contrast values, so the ratio maths itself is pinned and not
    //    merely self-consistent.
    {
      const bw = S.contrastRatio("#000000", "#ffffff");
      check("contrastRatio(black, white) === 21", Math.abs(bw - 21) < 1e-9, bw.toFixed(4));
      const same = S.contrastRatio("#4CA377", "#4CA377");
      check("contrastRatio(x, x) === 1", Math.abs(same - 1) < 1e-9, same.toFixed(4));
    }

    // 3. THE headline assertion: AA at every layer × every value × both themes.
    {
      let worstLight = { ratio: Infinity };
      let worstDark = { ratio: Infinity };
      let bad = 0;
      for (const layer of LAYERS) {
        for (let v = 0; v <= 100; v++) {
          const ink = S.rampInk(layer, v);
          const rl = S.contrastRatio(ink.light, S.SURFACE_LIGHT);
          const rd = S.contrastRatio(ink.dark, S.SURFACE_DARK);
          if (rl < S.AA_TEXT || rd < S.AA_TEXT) bad++;
          if (rl < worstLight.ratio) worstLight = { ratio: rl, layer, v, hex: ink.light };
          if (rd < worstDark.ratio) worstDark = { ratio: rd, layer, v, hex: ink.dark };
        }
      }
      check(
        `every score ink clears AA ${S.AA_TEXT}:1 in both themes (${LAYERS.length} layers × 101 values)`,
        bad === 0,
        bad ? `${bad} failing pairs` : "",
      );
      console.log(
        `       worst light: ${worstLight.hex} (${worstLight.layer}@${worstLight.v}) ` +
          `${worstLight.ratio.toFixed(2)}:1 on ${S.SURFACE_LIGHT}`,
      );
      console.log(
        `       worst dark:  ${worstDark.hex} (${worstDark.layer}@${worstDark.v}) ` +
          `${worstDark.ratio.toFixed(2)}:1 on ${S.SURFACE_DARK}`,
      );
    }

    // 4. Also safe on the OTHER surface each theme uses. SURFACE_LIGHT /
    //    SURFACE_DARK are the GOVERNING pair (--surface-sunken in light,
    //    --surface-elevated in dark); this covers their opposites, so the
    //    "worst case" reasoning in scoreColor.ts is asserted, not trusted.
    //    Getting that argument backwards is precisely how the first draft of
    //    this module shipped 86 sub-AA pairs.
    {
      let bad = 0;
      const misses = [];
      for (const layer of LAYERS) {
        for (let v = 0; v <= 100; v += 1) {
          const ink = S.rampInk(layer, v);
          const rl = S.contrastRatio(ink.light, "#ffffff"); // --surface-elevated, light
          const rd = S.contrastRatio(ink.dark, "#050505"); // --surface-sunken, dark
          if (rl < S.AA_TEXT || rd < S.AA_TEXT) {
            bad++;
            if (misses.length < 3) misses.push(`${layer}@${v} ${rl.toFixed(2)}/${rd.toFixed(2)}`);
          }
        }
      }
      check(
        "also clears AA on the non-governing surface in both themes",
        bad === 0,
        bad ? `${bad} pairs, e.g. ${misses.join(", ")}` : "",
      );
    }

    // 5. Hue is preserved: the colour identity is the meaning, and only
    //    lightness may move.
    //
    //    Measured as PERPENDICULAR CHROMA DISPLACEMENT (chroma × the hue angle,
    //    in 0–255 units) rather than as a raw angle. A raw angle is the wrong
    //    ruler here: near-greys like accessibility@51 (#7a7977) swing tens of
    //    degrees on a one-bit change while being visually identical, so an
    //    angular bound either fails on colours nobody could tell apart or has to
    //    be loosened until it stops catching real drift. Displacement is the
    //    thing an eye actually sees, and it is scale-free across the ramp: the
    //    worst case across all five layers is ~1.4/255, i.e. 8-bit rounding.
    {
      let worst = 0;
      let where = "";
      for (const layer of LAYERS) {
        for (let v = 0; v <= 100; v += 1) {
          const base = M.sampleRamp(layer, v);
          const ink = S.rampInk(layer, v);
          for (const [name, hex] of [["light", ink.light], ["dark", ink.dark]]) {
            const d = hueDelta(hueOf(base), hueOf(hex));
            const disp = (chromaOf(base) * d * Math.PI) / 180;
            if (disp > worst) {
              worst = disp;
              where = `${layer}@${v} ${name} ${base}→${hex} (${d.toFixed(2)}°)`;
            }
          }
        }
      }
      check(
        "hue is preserved through the adjustment (≤2/255 chroma displacement)",
        worst <= 2,
        `worst ${worst.toFixed(3)}/255 at ${where}`,
      );
    }

    // 6. A colour that already passes is returned untouched — no gratuitous
    //    drift away from the map for values that were fine to begin with.
    {
      const already = "#8A4B2D"; // bike@100, 6.4:1 on white
      check(
        "readableInk leaves an already-compliant colour alone",
        S.readableInk(already, S.SURFACE_LIGHT) === already,
        S.readableInk(already, S.SURFACE_LIGHT),
      );
    }

    // 7. The adjustment is minimal: the result sits close to the AA threshold
    //    rather than being slammed to black or white. If this fails, scores
    //    have stopped looking like the map even though they still "pass".
    {
      let worst = 0;
      let where = "";
      for (const layer of LAYERS) {
        for (let v = 0; v <= 100; v += 1) {
          for (const [bg, key] of [[S.SURFACE_LIGHT, "light"], [S.SURFACE_DARK, "dark"]]) {
            const hex = S.rampInk(layer, v)[key];
            const r = S.contrastRatio(hex, bg);
            // Untouched colours may legitimately be far above the bar; only
            // ADJUSTED ones must land near it.
            const base = M.sampleRamp(layer, v);
            if (S.contrastRatio(base, bg) >= S.AA_TEXT) continue;
            if (r > worst) {
              worst = r;
              where = `${layer}@${v} ${key} ${r.toFixed(2)}:1`;
            }
          }
        }
      }
      check("adjusted ink lands near the AA threshold, not slammed to b/w (≤6:1)", worst <= 6, where);
    }

    // 8. meterWidth clamps whatever crosses the maplibre boundary.
    {
      check("meterWidth clamps high", S.meterWidth(140) === "100%", S.meterWidth(140));
      check("meterWidth clamps low", S.meterWidth(-3) === "0%", S.meterWidth(-3));
      check("meterWidth rejects junk", S.meterWidth("87") === "0%", S.meterWidth("87"));
      check("meterWidth rejects NaN", S.meterWidth(NaN) === "0%", S.meterWidth(NaN));
    }
  } finally {
    rmSync(BUILD_DIR, { recursive: true, force: true });
    rmSync(TS_PROJECT, { force: true });
  }

  console.log("");
  if (failures.length) {
    console.error(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("PASS — score ink clears AA in both themes and the map ramp is untouched.");
}

main();
