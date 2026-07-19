#!/usr/bin/env node
/**
 * test-continuity-smoothing.mjs
 *
 * Locks two-tier continuity inference for continuous street infrastructure:
 *
 *   Tier 1 SANDWICH — 1–2 dissenting frames (even confident-absent) between
 *   confident-present neighbors → inferred-present.
 *   Tier 2 BOOKEND BRIDGE — confident-present bookends at any distance flip
 *   intervening WEAK-absents; a CONFIDENT-absent breaks the bridge.
 *
 * Fixtures (mandated):
 *   - sandwich of 1 → flips
 *   - sandwich of 2 → flips both
 *   - edge-of-run absents → must NOT flip
 *   - genuinely absent runs (≥3 confident) → must NOT flip
 *   - long occluded stretch with bookends (weak) → flips
 *   - long stretch with one confident-absent inside → bridge broken
 *   - bookend on one side only → no flip
 * Also: non-continuous items never smoothed; rollup + recompute share byte-identical results.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-continuity");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        rootDir: "../lib",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2022",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: [
        "../lib/capture/continuity.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/review-overrides.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/types.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
}

function reading(seq, value, confidence = 0.9, frameId = String(seq)) {
  return { seq, frameId, value, confidence };
}

function main() {
  compile();
  const C = require(path.join(BUILD_DIR, "capture", "continuity.js"));
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));
  const R = require(path.join(BUILD_DIR, "capture", "rollup.js"));
  const { recomputeReview, EMPTY_CORRECTIONS } = require(
    path.join(BUILD_DIR, "capture", "review-overrides.js"),
  );

  console.log("\nitem set — continuous vs excluded");
  {
    check("sidewalk_present is continuous", C.CONTINUOUS_INFRASTRUCTURE_ITEMS.has("sidewalk_present"));
    check("bike_lane_present is continuous", C.CONTINUOUS_INFRASTRUCTURE_ITEMS.has("bike_lane_present"));
    check("standing_water is NOT continuous", !C.CONTINUOUS_INFRASTRUCTURE_ITEMS.has("standing_water"));
    check("obstruction_free is NOT continuous", !C.CONTINUOUS_INFRASTRUCTURE_ITEMS.has("obstruction_free"));
    check("drain_present is NOT continuous", !C.CONTINUOUS_INFRASTRUCTURE_ITEMS.has("drain_present"));
  }

  console.log("\nclassification thresholds");
  {
    check(
      "weak-absent at conf 0.4",
      C.isWeakAbsent("sidewalk_present", reading(0, 0, 0.4)),
    );
    check(
      "confident-absent at conf 0.7",
      C.isConfidentAbsent("sidewalk_present", reading(0, 0, 0.7)),
    );
    check(
      "confident-present at conf 0.6",
      C.isConfidentPresent("sidewalk_present", reading(0, 1, 0.6)),
    );
  }

  console.log("\nTier 1 — sandwich of 1 (even confident-absent) flips");
  {
    const raw = [
      reading(0, 1, 0.9),
      reading(1, 0, 0.85), // confident-absent, still flips (frame-14 case)
      reading(2, 1, 0.95),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check("middle is inferred", out[1].inferred === true);
    check("middle value is present", out[1].value === 1);
    check("middle confidence reduced", out[1].confidence === 0.45, `${out[1].confidence}`);
    check("flanks untouched", out[0].inferred === false && out[2].inferred === false);
    check("flank values unchanged", out[0].value === 1 && out[2].value === 1);
  }

  console.log("\nTier 1 — sandwich of 2 flips both");
  {
    const raw = [
      reading(0, 1, 0.9),
      reading(1, 0, 0.75),
      reading(2, 0, 0.75),
      reading(3, 1, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check("both middle frames inferred", out[1].inferred && out[2].inferred);
    check("both flipped to present", out[1].value === 1 && out[2].value === 1);
  }

  console.log("\nedge-of-run absents — must NOT flip");
  {
    const leading = C.smoothContinuityReadings("sidewalk_present", [
      reading(0, 0, 0.9),
      reading(1, 1, 0.9),
      reading(2, 1, 0.9),
    ]);
    check("leading absent stays absent", leading[0].value === 0 && leading[0].inferred === false);

    const trailing = C.smoothContinuityReadings("sidewalk_present", [
      reading(0, 1, 0.9),
      reading(1, 1, 0.9),
      reading(2, 0, 0.9),
    ]);
    check("trailing absent stays absent", trailing[2].value === 0 && trailing[2].inferred === false);
  }

  console.log("\ngenuinely absent run (≥3 confident) — must NOT flip");
  {
    const raw = [
      reading(0, 1, 0.9),
      reading(1, 0, 0.9),
      reading(2, 0, 0.9),
      reading(3, 0, 0.9),
      reading(4, 1, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check(
      "three-absent gap untouched",
      out[1].value === 0 && out[2].value === 0 && out[3].value === 0,
    );
    check("none inferred", out.every((r) => !r.inferred));
  }

  console.log("\nTier 2 — long occluded stretch with bookends (weak) flips");
  {
    const raw = [
      reading(0, 1, 0.9),
      reading(1, 0, 0.4),
      reading(2, 0, 0.35),
      reading(3, 0, 0.5),
      reading(4, 0, 0.3),
      reading(5, 0, 0.45),
      reading(6, 1, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check(
      "all five weak absents inferred",
      out.slice(1, 6).every((r) => r.inferred && r.value === 1),
    );
    check("bookends not inferred", !out[0].inferred && !out[6].inferred);
  }

  console.log("\nTier 2 — confident-absent inside breaks the bridge");
  {
    const raw = [
      reading(0, 1, 0.9),
      reading(1, 0, 0.4),
      reading(2, 0, 0.4),
      reading(3, 0, 0.85), // confident-absent — breaks bridge
      reading(4, 0, 0.4),
      reading(5, 0, 0.4),
      reading(6, 1, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check(
      "bridge broken — no long-range flip",
      out.slice(1, 6).every((r) => r.value === 0 && !r.inferred),
    );
  }

  console.log("\nTier 2 — bookend on one side only (no flip)");
  {
    const leadingOnly = C.smoothContinuityReadings("sidewalk_present", [
      reading(0, 1, 0.9),
      reading(1, 0, 0.4),
      reading(2, 0, 0.4),
      reading(3, 0, 0.4),
      reading(4, 0, 0.4),
    ]);
    check(
      "no trailing bookend — weak stretch stays",
      leadingOnly.slice(1).every((r) => r.value === 0 && !r.inferred),
    );

    const trailingOnly = C.smoothContinuityReadings("sidewalk_present", [
      reading(0, 0, 0.4),
      reading(1, 0, 0.4),
      reading(2, 0, 0.4),
      reading(3, 0, 0.4),
      reading(4, 1, 0.9),
    ]);
    check(
      "no leading bookend — weak stretch stays",
      trailingOnly.slice(0, 4).every((r) => r.value === 0 && !r.inferred),
    );
  }

  console.log("\nneighbor confidence threshold");
  {
    const raw = [
      reading(0, 1, 0.5), // below threshold
      reading(1, 0, 0.9),
      reading(2, 1, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_present", raw);
    check("low-confidence neighbor does not anchor", out[1].value === 0 && !out[1].inferred);
  }

  console.log("\nnon-continuous item never smoothed");
  {
    const raw = [
      reading(0, 4, 0.9),
      reading(1, 0, 0.9),
      reading(2, 4, 0.9),
    ];
    const out = C.smoothContinuityReadings("standing_water", raw);
    check("ponding sandwich stays raw", out[1].value === 0 && !out[1].inferred);
  }

  console.log("\ngraded kin — sidewalk_width strongly lower flips");
  {
    const raw = [
      reading(0, 3, 0.9),
      reading(1, 0, 0.8),
      reading(2, 3, 0.9),
    ];
    const out = C.smoothContinuityReadings("sidewalk_width", raw);
    check("width dissent inferred", out[1].inferred === true);
    check("width takes conservative min of neighbors", out[1].value === 3, `${out[1].value}`);
  }

  /* -------- Rollup integration -------- */
  console.log("\nrollup — sandwich moves the median; honesty marked");
  {
    function obs(seq, sidewalk, nearJunction = false) {
      const items = {};
      for (const key of T.RUBRIC_ITEM_KEYS) {
        const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
        const v = rt === "boolean" ? 1 : rt === "percent" ? 50 : 3;
        items[key] = { value: v, confidence: 0.9 };
      }
      items.sidewalk_present = { value: sidewalk, confidence: 0.9 };
      return {
        frameId: String(seq),
        seq,
        segmentId: "north-st",
        model: "gpt-5-nano",
        items,
        usable: true,
        escalated: false,
        nearJunction,
      };
    }

    const rollups = R.computeRollups([
      obs(0, 1),
      obs(1, 0),
      obs(2, 1),
    ]);
    const median = rollups[0].itemMedians.sidewalk_present;
    check("median is present (1), not dragged to 0", median.value === 1, JSON.stringify(median));
    check("inferred flag set on item_medians", median.inferred === true);
    check("inferredFrames counts the sandwich", median.inferredFrames === 1, `${median.inferredFrames}`);

    const genuine = R.computeRollups([
      obs(0, 1),
      obs(1, 0),
      obs(2, 0),
      obs(3, 0),
      obs(4, 1),
    ]);
    const gMedian = genuine[0].itemMedians.sidewalk_present;
    check(
      "genuine absent run still produces absent-leaning median",
      gMedian.value === 0,
      JSON.stringify(gMedian),
    );
    check("genuine run not marked inferred", !gMedian.inferred);
  }

  console.log("\nrollup — Tier 2 bookend weak stretch flips median");
  {
    function obs(seq, sidewalk, conf = 0.9) {
      const items = {};
      for (const key of T.RUBRIC_ITEM_KEYS) {
        const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
        const v = rt === "boolean" ? 1 : rt === "percent" ? 50 : 3;
        items[key] = { value: v, confidence: 0.9 };
      }
      items.sidewalk_present = { value: sidewalk, confidence: conf };
      return {
        frameId: String(seq),
        seq,
        segmentId: "north-st",
        model: "gpt-5-nano",
        items,
        usable: true,
        escalated: false,
        nearJunction: false,
      };
    }
    const rollups = R.computeRollups([
      obs(0, 1, 0.9),
      obs(1, 0, 0.4),
      obs(2, 0, 0.4),
      obs(3, 0, 0.4),
      obs(4, 0, 0.4),
      obs(5, 1, 0.9),
    ]);
    const median = rollups[0].itemMedians.sidewalk_present;
    check("bookend bridge median is present", median.value === 1, JSON.stringify(median));
    check("bookend bridge marked inferred", median.inferred === true);
    check("inferredFrames = 4", median.inferredFrames === 4, `${median.inferredFrames}`);
  }

  console.log("\nrecompute shares rollup byte-for-byte");
  {
    function frame(seq, sidewalk) {
      const items = {};
      for (const key of T.RUBRIC_ITEM_KEYS) {
        const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
        const v = rt === "boolean" ? 1 : rt === "percent" ? 50 : 3;
        items[key] = { value: v, confidence: 0.9 };
      }
      items.sidewalk_present = { value: sidewalk, confidence: 0.9 };
      return {
        seq,
        storagePath: `captures/s/frame-${seq}.jpg`,
        segmentId: "north-st",
        nearJunction: false,
        usable: true,
        deleted: false,
        observation: {
          items,
          rationale: null,
          escalated: false,
          model: "gpt-5-nano",
        },
      };
    }
    const frames = [frame(0, 1), frame(1, 0), frame(2, 1)];
    const result = recomputeReview(frames, { ...EMPTY_CORRECTIONS });
    const ref = R.computeRollups(
      frames.map((f) => ({
        frameId: String(f.seq),
        seq: f.seq,
        segmentId: f.segmentId,
        model: f.observation.model,
        items: f.observation.items,
        usable: f.usable,
        escalated: f.observation.escalated,
        nearJunction: f.nearJunction,
      })),
    );
    check(
      "recompute itemMedians === computeRollups",
      JSON.stringify(result.segments[0].itemMedians) === JSON.stringify(ref[0].itemMedians),
    );
    check(
      "recompute baseline scores === computeRollups",
      JSON.stringify(result.segments[0].baselineScores) === JSON.stringify(ref[0].scores),
    );
  }

  console.log("\ninferredKeysForFrame helper");
  {
    const mates = [
      { frameId: "0", seq: 0, items: { sidewalk_present: { value: 1, confidence: 0.9 } } },
      { frameId: "1", seq: 1, items: { sidewalk_present: { value: 0, confidence: 0.8 } } },
      { frameId: "2", seq: 2, items: { sidewalk_present: { value: 1, confidence: 0.9 } } },
    ];
    const keys = C.inferredKeysForFrame("1", mates);
    check("frame 1 marked sidewalk_present", keys.has("sidewalk_present"));
    check("frame 0 not marked", !C.inferredKeysForFrame("0", mates).has("sidewalk_present"));
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("\nAll continuity smoothing checks passed.");
}

main();
