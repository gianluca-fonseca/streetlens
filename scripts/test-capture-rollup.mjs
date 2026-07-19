#!/usr/bin/env node
/**
 * test-capture-rollup.mjs (u29 ingest + extraction worker)
 *
 * Locks the aggregation: per-frame observations → per-segment lens scores.
 *
 * The cases that matter here are the ones where a plausible implementation is
 * quietly wrong: null treated as zero, a junction photo scoring a mid-block
 * sidewalk, an escalated frame voting twice, one hallucinated outlier dragging a
 * median. Each of those produces a number that looks like a measurement.
 *
 * Also checks the normalization and the overall composite against
 * scripts/generate-demo-audits.mjs, since the whole point of the shared rubric
 * is that a CV rollup and a human field audit mean the same thing by "72".
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-rollup");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        // Pinned, not inferred: tsc derives rootDir from the common ancestor of
        // `files`, so the emit layout would silently move if this list changed.
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
        "../lib/capture/scoring.ts",
        "../lib/capture/types.ts",
        "../lib/capture/track.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
}

/** Build an observation with every item at `value`, overriding some. */
function obs(T, { frameId, value = 3, confidence = 0.9, overrides = {}, ...rest }) {
  const items = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    const v = value === null ? null : rt === "boolean" ? 1 : rt === "percent" ? 50 : value;
    items[key] = { value: v, confidence };
  }
  for (const [k, v] of Object.entries(overrides)) items[k] = v;
  return {
    frameId,
    seq: rest.seq ?? (() => {
      const m = String(frameId).match(/(\d+)/);
      return m ? Number(m[1]) : 0;
    })(),
    segmentId: "north-st",
    model: "gpt-5-nano",
    items,
    usable: true,
    escalated: false,
    nearJunction: false,
    ...rest,
  };
}

function main() {
  compile();
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));
  const R = require(path.join(BUILD_DIR, "capture", "rollup.js"));
  const S = require(path.join(BUILD_DIR, "capture", "scoring.js"));
  const TR = require(path.join(BUILD_DIR, "capture", "track.js"));

  /* ---------------- Normalization ---------------- */
  console.log("\nnormalization (mirrors generate-demo-audits.mjs itemResponse)");
  {
    check("boolean 1 -> 1", S.normalizeItemValue("sidewalk_present", 1) === 1);
    check("boolean 0 -> 0", S.normalizeItemValue("sidewalk_present", 0) === 0);
    check("percent 50 -> 0.5", S.normalizeItemValue("canopy_cover", 50) === 0.5);
    check("scale_0_4 3 -> 0.75", S.normalizeItemValue("surface_condition", 3) === 0.75);
    check("scale_0_4 4 -> 1", S.normalizeItemValue("surface_condition", 4) === 1);
    check(
      "null stays null — 'not assessable' is not a zero",
      S.normalizeItemValue("surface_condition", null) === null,
    );
  }

  /* ---------------- Overall composite ---------------- */
  console.log("\noverall composite (generate-demo-audits.mjs:206-208)");
  {
    // accessibility 1.0, drainage 0.5, shade 0.0
    const normalized = {};
    for (const key of T.RUBRIC_ITEM_KEYS) {
      const lens = T.RUBRIC_ITEM_LAYERS[key];
      normalized[key] =
        lens === "accessibility" ? 1 : lens === "drainage" ? 0.5 : lens === "shade" ? 0 : null;
    }
    const scores = S.lensScoresFromItems(normalized);
    check("accessibility = 100", scores.accessibility === 100, `${scores.accessibility}`);
    check("drainage = 50", scores.drainage === 50, `${scores.drainage}`);
    check("shade = 0", scores.shade === 0, `${scores.shade}`);
    check(
      "overall = 0.45*acc + 0.30*drain + 0.25*shade = 60",
      near(scores.overall, 60),
      `${scores.overall}`,
    );
    check(
      "a lens with no assessable items is null, not 0 — 'could not see' is not 'is bad'",
      scores.bike === null,
      `${scores.bike}`,
    );
  }

  {
    // Only accessibility measured: overall renormalizes rather than being
    // dragged down by lenses nobody looked at.
    const normalized = {};
    for (const key of T.RUBRIC_ITEM_KEYS) {
      normalized[key] = T.RUBRIC_ITEM_LAYERS[key] === "accessibility" ? 0.8 : null;
    }
    const scores = S.lensScoresFromItems(normalized);
    check(
      "an unmeasured lens is excluded from overall, not scored as zero",
      near(scores.overall, 80),
      `${scores.overall} (a zero-fill would give 36)`,
    );
  }

  {
    const normalized = {};
    for (const key of T.RUBRIC_ITEM_KEYS) normalized[key] = null;
    const scores = S.lensScoresFromItems(normalized);
    check(
      "nothing assessable anywhere -> every lens null",
      S.LENS_KEYS.every((k) => scores[k] === null),
      JSON.stringify(scores),
    );
  }

  /* ---------------- Weighted median ---------------- */
  console.log("\nconfidence-weighted median");
  {
    const m = S.confidenceWeightedMedian([
      { value: 0, confidence: 0.9 },
      { value: 0, confidence: 0.9 },
      { value: 4, confidence: 0.9 },
    ]);
    check("a lone outlier does not move the median", m === 0, `${m}`);

    const weighted = S.confidenceWeightedMedian([
      { value: 0, confidence: 0.1 },
      { value: 4, confidence: 0.95 },
    ]);
    check("a confident read outweighs a hedged one", weighted === 4, `${weighted}`);

    check("no entries -> null", S.confidenceWeightedMedian([]) === null);
    check(
      "zero-confidence entries are not evidence",
      S.confidenceWeightedMedian([{ value: 3, confidence: 0 }]) === null,
    );
  }

  /* ---------------- Junction-sensitive items ---------------- */
  console.log("\njunction item routing (types.ts FrameAttribution.nearJunction)");
  {
    const observations = [
      // Mid-block frames: no crossing in shot, so they say null for curb_ramp.
      obs(T, {
        frameId: "f1",
        value: 4,
        nearJunction: false,
        overrides: { curb_ramp: { value: null, confidence: 0.9 } },
      }),
      // A junction frame that can see the crossing: no ramp there.
      obs(T, {
        frameId: "f2",
        value: 1,
        nearJunction: true,
        overrides: { curb_ramp: { value: 0, confidence: 0.95 } },
      }),
    ];
    const [rollup] = R.computeRollups(observations);

    check(
      "curb_ramp is read from the junction frame, which is the only one that can see it",
      rollup.itemMedians.curb_ramp.value === 0,
      JSON.stringify(rollup.itemMedians.curb_ramp),
    );
    check(
      "sidewalk_width is read from the mid-block frame, not the corner shot",
      rollup.itemMedians.sidewalk_width.value === 4,
      JSON.stringify(rollup.itemMedians.sidewalk_width),
    );
    check(
      "the junction frame does not contribute to mid-block items",
      rollup.itemMedians.sidewalk_width.frames === 1,
      `${rollup.itemMedians.sidewalk_width.frames} frames`,
    );
    check(
      "crossing_safety is junction-sourced too",
      rollup.itemMedians.crossing_safety.frames === 1,
      `${rollup.itemMedians.crossing_safety.frames}`,
    );
  }

  /* ---------------- Escalated frames ---------------- */
  console.log("\nescalated frames");
  {
    // One frame, two observations: the cheap model hedged low, the strong model
    // was asked and said 4. Counting both lets one frame vote twice.
    const observations = [
      obs(T, { frameId: "f1", value: 0, confidence: 0.2, model: "gpt-5-nano" }),
      obs(T, { frameId: "f1", value: 4, confidence: 0.95, model: "gpt-5.4-mini", escalated: true }),
    ];
    const [rollup] = R.computeRollups(observations);
    check(
      "an escalated frame counts once, as the stronger model's answer",
      rollup.itemMedians.surface_condition.value === 4 &&
        rollup.itemMedians.surface_condition.frames === 1,
      JSON.stringify(rollup.itemMedians.surface_condition),
    );
    check("coverage counts the frame once", rollup.coverage === 1, `${rollup.coverage}`);
  }

  /* ---------------- Unusable frames and coverage ---------------- */
  console.log("\nunusable frames and coverage");
  {
    const observations = [
      obs(T, { frameId: "f1", value: 3 }),
      obs(T, { frameId: "f2", value: null, confidence: 0.1, usable: false }),
      obs(T, { frameId: "f3", value: null, confidence: 0.1, usable: false }),
      obs(T, { frameId: "f4", value: null, confidence: 0.1, usable: false }),
    ];
    const [rollup] = R.computeRollups(observations);
    check(
      "an unusable frame contributes no values",
      rollup.itemMedians.surface_condition.frames === 1,
      `${rollup.itemMedians.surface_condition.frames}`,
    );
    check(
      "coverage divides by frames ATTRIBUTED (1/4), so blur shows up as poor coverage",
      near(rollup.coverage, 0.25),
      `${rollup.coverage}`,
    );
    check(
      "the segment still scores from the frame that worked",
      rollup.scores.accessibility !== null,
      JSON.stringify(rollup.scores),
    );
  }

  {
    const observations = [obs(T, { frameId: "f1", value: null, usable: false, confidence: 0.1 })];
    const [rollup] = R.computeRollups(observations);
    check(
      "a segment with nothing readable scores null everywhere and coverage 0",
      rollup.coverage === 0 && rollup.scores.overall === null && rollup.confidence === null,
      JSON.stringify({ c: rollup.coverage, s: rollup.scores.overall }),
    );
  }

  /* ---------------- Segment grouping ---------------- */
  console.log("\nsegment grouping");
  {
    const observations = [
      obs(T, { frameId: "f1", value: 4, segmentId: "north-st" }),
      obs(T, { frameId: "f2", value: 0, segmentId: "south-st" }),
      obs(T, { frameId: "f3", value: 2, segmentId: null }),
    ];
    const rollups = R.computeRollups(observations);
    check("one rollup per segment", rollups.length === 2, `${rollups.length}`);
    check(
      "an unattributed frame rolls up to nothing — there is no segment to score",
      !rollups.some((r) => r.segmentId === null),
    );
    const north = rollups.find((r) => r.segmentId === "north-st");
    const south = rollups.find((r) => r.segmentId === "south-st");
    check(
      "segments score independently",
      north.scores.accessibility > south.scores.accessibility,
      `${north.scores.accessibility} vs ${south.scores.accessibility}`,
    );
  }

  /* ---------------- Track hygiene ---------------- */
  console.log("\ntrack validation and interpolation");
  {
    const t0 = 1_700_000_000_000;
    const fixes = (n, acc) =>
      Array.from({ length: n }, (_, i) => ({
        lat: 9.906 + i * 0.0001,
        lng: -84.15,
        t: t0 + i * 5000,
        ...(acc === undefined ? {} : { accuracy: acc }),
      }));

    check(
      "a live track needs 10 fixes",
      TR.validateTrack(fixes(5), "live").ok === false,
    );
    check("a 10-fix live track over 45 s is fine", TR.validateTrack(fixes(10), "live").ok === true);
    check(
      "a sparse gpx import is accepted — it is not a live capture and must not be held to one",
      TR.validateTrack(fixes(3), "gpx").ok === true,
    );

    const noisy = TR.validateTrack(fixes(10, 40), "live");
    check(
      "fixes with error bars wider than the matcher's gate are dropped",
      noisy.ok === false && noisy.dropped === 10,
      JSON.stringify(noisy),
    );
    check(
      "a fix that reports no accuracy is kept, not assumed bad",
      TR.validateTrack(fixes(10), "live").dropped === 0,
    );

    const track = fixes(10);
    const mid = TR.interpolateAt(track, t0 + 2500);
    check(
      "a frame between two fixes interpolates",
      near(mid.lat, 9.90605, 0.00001),
      JSON.stringify(mid),
    );
    check(
      "a frame before the track began has no location, rather than an invented one",
      TR.interpolateAt(track, t0 - 60_000) === null,
    );
    check(
      "a frame after the track ended is null too",
      TR.interpolateAt(track, t0 + 10_000_000) === null,
    );
    check("an exact fix time returns that fix", near(TR.interpolateAt(track, t0).lat, 9.906));
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — capture rollup + scoring");
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

main();
