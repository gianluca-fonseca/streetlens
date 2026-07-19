#!/usr/bin/env node
/**
 * test-guided-dialogue.mjs (bgsd-0015 reviewer dialogue)
 *
 * Locks: frame-ref parsing (#N, #N-M, mixed, invalid), context assembly token
 * bounds (8k cap, truncate oldest turns, keep rollup+spatial), and guided
 * recompute score merge + provenance (exceeds ±20, reasons required,
 * renormalized overall, human_corrected provenance).
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-guided-dialogue");
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
        "../lib/extraction/guided-frame-refs.ts",
        "../lib/extraction/guided-context.ts",
        "../lib/extraction/guided-dialogue.ts",
        "../lib/extraction/synthesis.ts",
        "../lib/extraction/config.ts",
        "../lib/extraction/client.ts",
        "../lib/extraction/prompt.ts",
        "../lib/extraction/schema.ts",
        "../lib/capture/types.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/continuity.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/schemas.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/lib/")) {
      return originalResolve.call(
        this,
        path.join(BUILD_DIR, request.slice("@/lib/".length)),
        ...rest,
      );
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function emptyItems(T) {
  const items = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    items[key] = { value: 1, confidence: 0.9 };
  }
  return items;
}

function frame(T, seq, lng, lat) {
  return {
    seq,
    location: { lng, lat },
    nearJunction: false,
    usable: true,
    items: emptyItems(T),
    rationale: `note ${seq}`,
  };
}

function baseline() {
  return {
    overall: 60,
    accessibility: 50,
    drainage: 60,
    shade: 70,
    bike: 40,
  };
}

function draft(adjust = {}) {
  const base = (d = 0, reason = "") => ({ delta: d, reason });
  return {
    overall: "Corrected: sidewalk present throughout.",
    lenses: {
      accessibility: "Sidewalk continuous per reviewer.",
      drainage: "unchanged drainage",
      shade: "unchanged shade",
      bike: "unchanged bike",
    },
    adjustments: {
      accessibility: base(0, ""),
      drainage: base(0, ""),
      shade: base(0, ""),
      bike: base(0, ""),
      ...adjust,
    },
    overall_es: "Corregido: hay acera en todo el tramo.",
    lenses_es: {
      accessibility: "Acera continua según el revisor.",
      drainage: "drenaje sin cambio",
      shade: "sombra sin cambio",
      bike: "bici sin cambio",
    },
  };
}

function spatialStub(refs = []) {
  return {
    identity: {
      id: "esc-sa-0001",
      name: "Calle Ejemplo",
      district: "San Antonio",
      highway: "residential",
      lengthM: 200,
    },
    direction: "start→end",
    frameCount: 20,
    coveragePct: 0.9,
    matchConfidence: 0.85,
    anchors: { start: [1, 2], middle: [10], end: [18, 19] },
    neighbors: { atStart: ["Calle Norte"], atEnd: ["Calle Sur"] },
    referencedPositions: refs.map((seq) => ({
      seq,
      alongM: seq * 10,
      fraction: (seq * 10) / 200,
      nearJunction: false,
      location: { lng: -84.1, lat: 9.9 },
    })),
  };
}

compile();

const Refs = require(path.join(BUILD_DIR, "extraction/guided-frame-refs.js"));
const Ctx = require(path.join(BUILD_DIR, "extraction/guided-context.js"));
const Dial = require(path.join(BUILD_DIR, "extraction/guided-dialogue.js"));
const Scoring = require(path.join(BUILD_DIR, "capture/scoring.js"));
const Types = require(path.join(BUILD_DIR, "capture/types.js"));

console.log("\nframe-ref parsing");
{
  const known = new Set([1, 2, 3, 4, 5, 9, 14]);

  const single = Refs.resolveFrameRefs("see #14 please", known);
  check("parses #N", single.length === 1 && single[0].from === 14 && single[0].valid);

  const range = Refs.resolveFrameRefs("span #1-9 here", known);
  check(
    "parses #N-M inclusive",
    range.length === 1 &&
      range[0].from === 1 &&
      range[0].to === 9 &&
      range[0].seqs.join(",") === "1,2,3,4,5,9",
  );

  const dash = Refs.resolveFrameRefs("en-dash #1–3", known);
  check("parses en-dash range", dash[0]?.valid && dash[0].seqs.join(",") === "1,2,3");

  const mixed = Refs.resolveFrameRefs("bookends #3 and #14 plus #1-2", known);
  check(
    "parses mixed refs",
    mixed.length >= 2 &&
      Refs.referencedSeqs("bookends #3 and #14 plus #1-2", known).join(",") === "1,2,3,14",
  );

  const bad = Refs.resolveFrameRefs("ghost #99 and #0", known);
  check(
    "marks invalid refs",
    bad.every((r) => !r.valid),
  );

  const tokens = Refs.tokenizeFrameRefsValidated("ok #14 bad #99", known);
  const kinds = tokens.filter((t) => t.kind !== "text").map((t) => t.kind);
  check("validated tokenize marks invalid", kinds.join(",") === "ref,invalid");
}

console.log("\ncontext assembly token bounds");
{
  const T = Types;
  const frames = Array.from({ length: 20 }, (_, i) =>
    frame(T, i + 1, -84.1 + i * 0.0001, 9.9),
  );
  const rollup = {
    segmentId: "esc-sa-0001",
    baselineScores: baseline(),
    currentScores: baseline(),
    itemMedians: { sidewalk_present: { value: 1, confidence: 0.9, frames: 20 } },
    assessment: {
      overall: "Original assessment claiming no sidewalk.",
      lenses: {
        accessibility: "no sidewalk",
        drainage: "ok",
        shade: "ok",
        bike: "ok",
      },
      adjustments: {},
      adjustedScores: baseline(),
      model: "test",
    },
    assessmentEs: { overall: "Sin acera.", lenses: { accessibility: "x", drainage: "x", shade: "x", bike: "x" } },
    coverage: 0.9,
    confidence: 0.85,
  };

  const longTurns = Array.from({ length: 80 }, (_, i) => ({
    role: i % 2 === 0 ? "reviewer" : "assistant",
    content: `turn ${i} ` + "x".repeat(800),
  }));

  const assembled = Ctx.assembleDialogueContext({
    rollup,
    spatial: spatialStub([3, 14]),
    frames,
    transcript: longTurns,
    latestUserMessage: "there IS a sidewalk throughout — see #3 and #14",
    tokenCap: 8000,
  });

  check(
    "stays under 8k token cap",
    assembled.estimatedTokens <= 8000,
    `(got ${assembled.estimatedTokens})`,
  );
  check("truncates oldest turns", assembled.truncatedTurns > 0, `(dropped ${assembled.truncatedTurns})`);

  const tight = Ctx.assembleDialogueContext({
    rollup,
    spatial: spatialStub([3, 14]),
    frames,
    transcript: longTurns,
    latestUserMessage: "there IS a sidewalk throughout — see #3 and #14",
    tokenCap: 2500,
  });
  check(
    "lower cap still keeps rollup+spatial",
    tight.userPayload.includes("SEGMENT ROLLUP") && tight.userPayload.includes("SPATIAL"),
  );
  check("lower cap truncates more", tight.truncatedTurns >= assembled.truncatedTurns);
  check("keeps rollup block", assembled.userPayload.includes("SEGMENT ROLLUP"));
  check("keeps spatial block", assembled.userPayload.includes("SPATIAL"));
  check(
    "includes only referenced frame evidence",
    assembled.referencedSeqs.join(",") === "3,14" &&
      assembled.userPayload.includes("#3") &&
      assembled.userPayload.includes("#14") &&
      !assembled.userPayload.includes("#10 |"),
  );
  check(
    "spatial mentions neighbors",
    assembled.spatialBlock.includes("Calle Norte") && assembled.spatialBlock.includes("Calle Sur"),
  );
}

console.log("\nguided recompute score merge + provenance");
{
  const base = baseline();

  // Exceeds autonomous ±20: +35 accessibility with a reason referencing correction.
  const big = Dial.applyGuidedAssessment(
    draft({
      accessibility: {
        delta: 35,
        reason: "Reviewer: sidewalk present throughout (#3–#14 bookend the span).",
      },
    }),
    base,
    "gpt-test",
  );
  check("allows delta beyond ±20 when reasoned", big.adjustments.accessibility?.delta === 35);
  check(
    "applies large delta to accessibility",
    near(big.adjustedScores.accessibility, 85),
    `(got ${big.adjustedScores.accessibility})`,
  );
  const expectedOverall = Scoring.renormalizedOverall(
    big.adjustedScores.accessibility,
    big.adjustedScores.drainage,
    big.adjustedScores.shade,
  );
  check(
    "overall recomputed by sealed formula",
    near(big.adjustedScores.overall, expectedOverall),
    `(got ${big.adjustedScores.overall}, expected ${expectedOverall})`,
  );

  const dropped = Dial.applyGuidedAssessment(
    draft({ accessibility: { delta: 40, reason: "" } }),
    base,
    "gpt-test",
  );
  check("drops reasonless delta", !dropped.adjustments.accessibility);
  check(
    "reasonless leaves baseline accessibility",
    near(dropped.adjustedScores.accessibility, 50),
  );

  const nullBase = { ...base, bike: null };
  const nullLens = Dial.applyGuidedAssessment(
    draft({ bike: { delta: 50, reason: "invent a bike lane" } }),
    nullBase,
    "gpt-test",
  );
  check("null baseline stays null", nullLens.adjustedScores.bike === null);

  const manual = Dial.mergeGuidedScoresIntoManual("esc-sa-0001", big.adjustedScores, {});
  check("merge writes accessibility into manual scores", near(manual.accessibility, 85));
  check("merge writes overall into manual scores", near(manual.overall, expectedOverall));

  const prov = Dial.buildDialogueProvenance(big, "2026-07-18T00:00:00.000Z");
  check("provenance marks human_corrected", prov.human_corrected === true);
  check("provenance source is reviewer_dialogue", prov.source === "reviewer_dialogue");
  check(
    "provenance records lens reason",
    prov.lens_reasons.accessibility?.reason.includes("sidewalk"),
  );
}

console.log("\n---");
if (failures.length) {
  console.error(`FAIL ${failures.length}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS guided-dialogue");
process.exit(0);
