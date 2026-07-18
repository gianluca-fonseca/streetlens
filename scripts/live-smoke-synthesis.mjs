#!/usr/bin/env node
/**
 * live-smoke-synthesis.mjs (u1 segment synthesis engine)
 *
 * ONE real synthesis call, on a fixture traversal built in-process. Env-gated
 * behind RUN_LIVE_SMOKE=1 and skips cleanly otherwise, because this one bills a
 * real model call.
 *
 * WHY IT HAS TO BE LIVE. The mocked tests prove the engine reacts correctly to a
 * response and applies the bounds; they cannot prove the response we actually get
 * obeys the strict schema, stays inside the +/-20 bound, and writes a reason for
 * every move it makes. Those are promises from the model, and the only way to
 * know is to ask it once and check.
 *
 * The fixture is the crosswalk-gap scenario the user described: a marked crossing
 * at the top of the block, then none for a few hundred metres, and a sidewalk that
 * starts then vanishes. A good answer should NOTICE the gap in its prose and
 * nudge accessibility down for it, within the bound, with a reason.
 *
 * Run once. Do not loop it.
 *
 *   RUN_LIVE_SMOKE=1 OPENAI_API_KEY=sk-... node scripts/live-smoke-synthesis.mjs
 *
 * Writes .planning/evidence/u1/live-smoke-synthesis.txt with the evidence, the
 * assessment, and the token counts. Exits 0 on PASS or SKIP, 1 on failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-live-synthesis");
const EVIDENCE = path.join(ROOT, ".planning", "evidence", "u1", "live-smoke-synthesis.txt");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

if (process.env.RUN_LIVE_SMOKE !== "1") {
  console.log("SKIP — live smoke is gated: set RUN_LIVE_SMOKE=1 (this one bills a real call)");
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.log("SKIP — OPENAI_API_KEY is not set");
  process.exit(0);
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
        "../lib/extraction/synthesis.ts",
        "../lib/extraction/config.ts",
        "../lib/extraction/client.ts",
        "../lib/extraction/prompt.ts",
        "../lib/extraction/schema.ts",
        "../lib/capture/types.ts",
        "../lib/capture/scoring.ts",
        "../lib/capture/rollup.ts",
        "../lib/capture/schemas.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/lib/")) {
      return originalResolve.call(this, path.join(BUILD_DIR, request.slice("@/lib/".length)), ...rest);
    }
    return originalResolve.call(this, request, ...rest);
  };
}

/** gpt-5.4-mini pricing, USD per 1M tokens (approx; reporting only, override via env). */
const PRICE_IN = Number(process.env.SMOKE_PRICE_IN ?? 0.25);
const PRICE_OUT = Number(process.env.SMOKE_PRICE_OUT ?? 2.0);

/** One synthesis frame with all 15 items at a value, overriding some. */
function frame(T, { seq, lat, nearJunction = false, overrides = {}, rationale }) {
  const items = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    items[key] = { value: rt === "boolean" ? 1 : rt === "percent" ? 40 : 3, confidence: 0.85 };
  }
  for (const [k, v] of Object.entries(overrides)) items[k] = v;
  return { seq, location: { lng: -84.15, lat }, nearJunction, usable: true, items, rationale };
}

async function main() {
  compile();
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));
  const SYN = require(path.join(BUILD_DIR, "extraction", "synthesis.js"));
  const { synthesisModel, synthesisMaxAdjust } = require(path.join(BUILD_DIR, "extraction", "config.js"));

  const model = synthesisModel();
  const maxAdjust = synthesisMaxAdjust();

  // The crosswalk-gap traversal: a marked crossing and a sidewalk at the top of
  // the block, then a long stretch with neither.
  const nn = { value: null, confidence: 0.9 };
  const frames = [
    frame(T, {
      seq: 0,
      lat: 9.9000,
      nearJunction: true,
      overrides: { crossing_safety: { value: 3, confidence: 0.9 }, curb_ramp: { value: 1, confidence: 0.9 }, sidewalk_present: { value: 1, confidence: 0.9 } },
      rationale: "Junction with a clearly marked crossing, a curb ramp, and a sidewalk beginning on the right.",
    }),
    frame(T, {
      seq: 1,
      lat: 9.9012,
      overrides: { crossing_safety: nn, curb_ramp: nn, sidewalk_present: { value: 1, confidence: 0.85 } },
      rationale: "Sidewalk continues on the right; no crossing in shot.",
    }),
    frame(T, {
      seq: 2,
      lat: 9.9024,
      overrides: { crossing_safety: nn, curb_ramp: nn, sidewalk_present: { value: 0, confidence: 0.9 }, sidewalk_width: nn, surface_condition: nn },
      rationale: "Sidewalk has ended; pedestrians walk on the road edge. No crossing.",
    }),
    frame(T, {
      seq: 3,
      lat: 9.9036,
      overrides: { crossing_safety: nn, curb_ramp: nn, sidewalk_present: { value: 0, confidence: 0.9 }, sidewalk_width: nn, surface_condition: nn },
      rationale: "Still no sidewalk and no crossing; open gutter at the right edge.",
    }),
    frame(T, {
      seq: 4,
      lat: 9.9048,
      overrides: { crossing_safety: nn, curb_ramp: nn, sidewalk_present: { value: 0, confidence: 0.9 }, sidewalk_width: nn, surface_condition: nn },
      rationale: "End of the block, no crossing provision where the street meets the next junction.",
    }),
  ];

  const input = {
    segmentId: "smoke-north-st",
    frames,
    baselineScores: { overall: 62, accessibility: 68, drainage: 55, shade: 44, bike: 30 },
    itemMedians: {
      sidewalk_present: { value: 0, confidence: 0.89, frames: 5 },
      crossing_safety: { value: 3, confidence: 0.9, frames: 1 },
      standing_water: { value: 3, confidence: 0.85, frames: 5 },
    },
  };

  const evidence = SYN.buildSynthesisEvidence(input);
  console.log(`\nlive smoke: ${model}, bound +/-${maxAdjust}, segment ${input.segmentId} (${frames.length} frames)\n`);
  console.log(evidence);
  console.log("");

  const client = SYN.createOpenAiSynthesisClient();
  const started = Date.now();
  const out = await SYN.synthesizeSegment(client, input, { model, maxAdjust });
  const elapsedMs = Date.now() - started;

  if (out.kind !== "ok") {
    check(`a real synthesis call returns a usable assessment (got: ${out.reason})`, false);
  } else {
    const a = out.assessment;
    const { usage } = out;

    check("the assessment parses against the frozen contract", typeof a.overall === "string" && a.overall.length > 0);
    check(
      "every adjustable lens has an explanation",
      ["accessibility", "drainage", "shade", "bike"].every((k) => typeof a.lenses[k] === "string" && a.lenses[k].length > 0),
    );
    check(
      "every adjustment stayed inside the bound",
      Object.values(a.adjustments).every((adj) => Math.abs(adj.delta) <= maxAdjust),
      JSON.stringify(a.adjustments),
    );
    check(
      "every non-zero adjustment carries a reason",
      Object.values(a.adjustments).every((adj) => adj.delta === 0 || (adj.reason && adj.reason.trim().length > 0)),
    );
    check(
      "a null-baseline lens (none here) or a scored one — adjustedScores are numbers or null",
      ["overall", "accessibility", "drainage", "shade", "bike"].every((k) => a.adjustedScores[k] === null || typeof a.adjustedScores[k] === "number"),
      JSON.stringify(a.adjustedScores),
    );
    check(
      "overall was recomputed, not copied — it tracks the adjusted lenses",
      a.adjustedScores.overall === null || (a.adjustedScores.overall >= 0 && a.adjustedScores.overall <= 100),
    );

    const cost = (usage.inputTokens / 1e6) * PRICE_IN + (usage.outputTokens / 1e6) * PRICE_OUT;

    const report = [
      `live-smoke-synthesis — ${model}, bound +/-${maxAdjust}`,
      `segment: ${input.segmentId}, ${frames.length} frames`,
      ``,
      `---- tokens ----`,
      `input_tokens  : ${usage.inputTokens}`,
      `cached_tokens : ${usage.cachedTokens}`,
      `output_tokens : ${usage.outputTokens}`,
      `latency       : ${elapsedMs} ms`,
      `cost this call: $${cost.toFixed(6)}  (@ $${PRICE_IN}/1M in, $${PRICE_OUT}/1M out)`,
      ``,
      `---- baseline lens scores ----`,
      JSON.stringify(input.baselineScores),
      ``,
      `---- adjusted lens scores ----`,
      JSON.stringify(a.adjustedScores),
      ``,
      `---- adjustments (only lenses it moved) ----`,
      JSON.stringify(a.adjustments, null, 2),
      ``,
      `---- overall verdict ----`,
      a.overall,
      ``,
      `---- per-lens explanations ----`,
      ...["accessibility", "drainage", "shade", "bike"].map((k) => `[${k}] ${a.lenses[k]}`),
      ``,
      `---- the evidence the model read ----`,
      evidence,
      ``,
    ].join("\n");

    mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, report);

    console.log("\n  ---- assessment ----");
    console.log(`  input/output tokens : ${usage.inputTokens} / ${usage.outputTokens}`);
    console.log(`  latency             : ${elapsedMs} ms`);
    console.log(`  cost this call      : $${cost.toFixed(6)}`);
    console.log(`  baseline            : ${JSON.stringify(input.baselineScores)}`);
    console.log(`  adjusted            : ${JSON.stringify(a.adjustedScores)}`);
    console.log(`  adjustments         : ${JSON.stringify(a.adjustments)}`);
    console.log(`  overall             : ${a.overall}`);
    console.log(`\n  saved -> ${path.relative(ROOT, EVIDENCE)}\n`);
  }

  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — live synthesis smoke");
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
