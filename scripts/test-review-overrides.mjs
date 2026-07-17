#!/usr/bin/env node
/**
 * test-review-overrides.mjs (u2 review inspector + overrides)
 *
 * Locks the reviewer-correction recompute. The one property that matters above all
 * others: recomputeReview reuses the SAME rollup math the server used, so with no
 * manual score edits its output is byte-identical to computeRollups run directly on
 * the surviving observations. Everything else — exclusion moving a score, a segment
 * dropping when it loses its last frame, a manual edit winning, a null override
 * meaning "not assessable" — is checked against that same real math, never a
 * hand-computed number that could drift from the server.
 *
 * Exits 0 on PASS, 1 on any failure. No database, no clock.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-review-overrides");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Deep-equal good enough for plain rollup objects (numbers, strings, null, nesting). */
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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
        "../lib/capture/review-overrides.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/types.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
}

let T; // types
let R; // rollup

/** All 15 items at `value` (encoded per response type), with per-key overrides. */
function items(value, confidence, overrides) {
  const out = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    const v = value === null ? null : rt === "boolean" ? 1 : rt === "percent" ? 50 : value;
    out[key] = { value: v, confidence };
  }
  for (const [k, v] of Object.entries(overrides ?? {})) out[k] = v;
  return out;
}

/** A review frame carrying a full observation. */
function frame(seq, opts = {}) {
  const {
    segmentId = "north-st",
    nearJunction = false,
    usable = true,
    value = 3,
    confidence = 0.9,
    itemOverrides = {},
    model = "gpt-5-nano",
    escalated = false,
    rationale = `frame ${seq} looked fine`,
    observation = true,
    deleted = false,
  } = opts;
  return {
    seq,
    storagePath: `captures/sess/frame-${String(seq).padStart(4, "0")}.jpg`,
    segmentId,
    nearJunction,
    usable,
    deleted,
    observation: observation
      ? { items: items(value, confidence, itemOverrides), rationale, escalated, model }
      : null,
  };
}

/** Turn a frame + a per-frame item override map into the RollupObservation the server sees. */
function toObs(f, itemOverridesBySeq) {
  const over = itemOverridesBySeq?.[f.seq];
  const itemsCopy = { ...f.observation.items };
  if (over) {
    for (const [k, v] of Object.entries(over)) itemsCopy[k] = { value: v ?? null, confidence: 1 };
  }
  return {
    frameId: String(f.seq),
    segmentId: f.segmentId,
    model: f.observation.model,
    items: itemsCopy,
    usable: f.usable,
    escalated: f.observation.escalated,
    nearJunction: f.nearJunction,
  };
}

/** The reference: computeRollups over exactly the frames that survive the corrections. */
function referenceRollups(frames, corrections) {
  const excluded = new Set(corrections.excluded ?? []);
  const deleted = new Set(corrections.deleted ?? []);
  const obs = frames
    .filter((f) => f.observation && !f.deleted && !deleted.has(f.seq) && !excluded.has(f.seq))
    .map((f) => toObs(f, corrections.itemOverrides));
  return R.computeRollups(obs);
}

const OV = () => require(path.join(BUILD_DIR, "capture", "review-overrides.js"));

function main() {
  compile();
  T = require(path.join(BUILD_DIR, "capture", "types.js"));
  R = require(path.join(BUILD_DIR, "capture", "rollup.js"));
  const { recomputeReview, EMPTY_CORRECTIONS } = OV();

  const corr = (partial = {}) => ({ ...EMPTY_CORRECTIONS, ...partial });

  /* ---------------- 1. Identity: same math as the server ---------------- */
  console.log("\nidentity — recompute with no corrections equals computeRollups");
  {
    const frames = [
      frame(0, { value: 3 }),
      frame(1, { value: 4 }),
      frame(2, { value: 2, nearJunction: true }),
    ];
    const result = recomputeReview(frames, corr());
    const ref = referenceRollups(frames, corr());
    check("one segment survives", result.segments.length === 1);
    const s = result.segments[0];
    check("scores match computeRollups", eq(s.scores, ref[0].scores), JSON.stringify(s.scores));
    check("itemMedians match", eq(s.itemMedians, ref[0].itemMedians));
    check("coverage matches", s.coverage === ref[0].coverage);
    check("confidence matches", s.confidence === ref[0].confidence);
    check("frameRefs list every surviving attributed frame", s.frameRefs.length === 3);
    check("no drops", result.droppedSegmentIds.length === 0);
    check("not marked human-corrected", s.humanCorrected === false);
  }

  /* ---------------- 2. Item override moves the score, still via real math ---------------- */
  console.log("\nitem override — value swap recomputes through computeRollups");
  {
    const frames = [frame(0, { value: 4 }), frame(1, { value: 4 })];
    const corrections = corr({ itemOverrides: { 0: { surface_condition: 0 } } });
    const result = recomputeReview(frames, corrections);
    const ref = referenceRollups(frames, corrections);
    const s = result.segments[0];
    check("overridden score equals reference math", eq(s.scores, ref[0].scores));
    check("accessibility dropped vs unedited", s.scores.accessibility < 100);
    check("human-corrected flag set", s.humanCorrected === true);
    check("override recorded in per-segment record", eq(s.overrides.items, { 0: { surface_condition: 0 } }));
  }

  /* ---------------- 3. Null override = not assessable (drops out) ---------------- */
  console.log("\nnull override — 'not assessable' drops the item, not scores it zero");
  {
    const frames = [frame(0, { value: 4 })];
    const withNull = recomputeReview(frames, corr({ itemOverrides: { 0: { canopy_cover: null } } }));
    const ref = referenceRollups(frames, corr({ itemOverrides: { 0: { canopy_cover: null } } }));
    check("null override matches reference", eq(withNull.segments[0].scores, ref[0].scores));
    check(
      "canopy_cover median is null after override",
      withNull.segments[0].itemMedians.canopy_cover.value === null,
    );
  }

  /* ---------------- 4. Exclude a frame moves coverage/score ---------------- */
  console.log("\nexclude — a frame leaves scoring immediately");
  {
    const frames = [frame(0, { value: 4 }), frame(1, { value: 1 }), frame(2, { value: 4 })];
    const corrections = corr({ excluded: [1] });
    const result = recomputeReview(frames, corrections);
    const ref = referenceRollups(frames, corrections);
    const s = result.segments[0];
    check("excluded recompute equals reference", eq(s.scores, ref[0].scores));
    check("frameRefs no longer include the excluded frame", s.frameRefs.length === 2);
    check("excluded seq recorded", eq(s.overrides.excludedSeqs, [1]));
    check("human-corrected set by exclusion", s.humanCorrected === true);
  }

  /* ---------------- 5. Losing the last frame drops the segment ---------------- */
  console.log("\nsegment drop — excluding every frame removes the segment from the proposal");
  {
    const frames = [
      frame(0, { segmentId: "a", value: 3 }),
      frame(1, { segmentId: "b", value: 3 }),
    ];
    const result = recomputeReview(frames, corr({ excluded: [1] }));
    check("segment b dropped", result.droppedSegmentIds.includes("b"));
    check("only segment a survives", result.segments.length === 1 && result.segments[0].segmentId === "a");
  }

  /* ---------------- 6. Delete behaves like exclude for scoring ---------------- */
  console.log("\ndelete — a deleted frame never scores, and a pre-tombstoned frame is honored");
  {
    const frames = [frame(0, { value: 4 }), frame(1, { value: 1 })];
    const viaCorrection = recomputeReview(frames, corr({ deleted: [1] }));
    const viaTombstone = recomputeReview(
      [frame(0, { value: 4 }), frame(1, { value: 1, deleted: true })],
      corr(),
    );
    const ref = referenceRollups(frames, corr({ deleted: [1] }));
    check("delete-by-correction matches reference", eq(viaCorrection.segments[0].scores, ref[0].scores));
    check(
      "delete-by-tombstone matches delete-by-correction",
      eq(viaTombstone.segments[0].scores, viaCorrection.segments[0].scores),
    );
    check("deleted seq recorded", eq(viaCorrection.segments[0].overrides.deletedSeqs, [1]));
  }

  /* ---------------- 7. Manual score edit wins over the recompute ---------------- */
  console.log("\nmanual score — a hand-set lens score wins over the recomputed one");
  {
    const frames = [frame(0, { value: 4 })];
    const result = recomputeReview(frames, corr({ manualScores: { "north-st": { overall: 42.5 } } }));
    const s = result.segments[0];
    check("overall is the manual value", s.scores.overall === 42.5);
    check("manualEdited flagged", s.manualEdited === true);
    check("other lenses untouched by the manual overall", s.scores.accessibility !== 42.5);
    check("manual score recorded", eq(s.overrides.scores, { overall: 42.5 }));
  }

  /* ---------------- 8. Manual null clears a lens ---------------- */
  console.log("\nmanual null — a reviewer can set a lens to 'no reading'");
  {
    const frames = [frame(0, { value: 4 })];
    const result = recomputeReview(frames, corr({ manualScores: { "north-st": { bike: null } } }));
    check("bike cleared to null", result.segments[0].scores.bike === null);
    check("manualEdited flagged for a null edit", result.segments[0].manualEdited === true);
  }

  /* ---------------- 9. Junction override affects only junction items ---------------- */
  console.log("\njunction — a junction-frame override reaches curb_ramp, a mid-block one does not");
  {
    const frames = [
      frame(0, { nearJunction: true, value: 4 }),
      frame(1, { nearJunction: false, value: 4 }),
    ];
    const corrections = corr({ itemOverrides: { 0: { curb_ramp: 0 } } });
    const result = recomputeReview(frames, corrections);
    const ref = referenceRollups(frames, corrections);
    check("curb_ramp override matches reference math", eq(result.segments[0].scores, ref[0].scores));
    check("curb_ramp median reflects the override (0)", result.segments[0].itemMedians.curb_ramp.value === 0);
  }

  console.log(`\n${failures.length ? `FAIL (${failures.length})` : "PASS"}`);
  rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
}

main();
