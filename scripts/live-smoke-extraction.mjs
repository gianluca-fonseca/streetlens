#!/usr/bin/env node
/**
 * live-smoke-extraction.mjs (u29 ingest + extraction worker)
 *
 * ONE real gpt-5-nano call, on one committed fixture image. Env-gated behind
 * RUN_LIVE_SMOKE=1 and skips cleanly otherwise, because this one costs money.
 *
 * WHY IT HAS TO BE LIVE. The mocked tests prove the worker reacts correctly to a
 * response; they cannot prove the response we actually get is the one we
 * assumed. Two things are only knowable against the real API:
 *
 *   1. THE BILLED TOKEN COUNT. `detail: "low"` should cap the image around 85
 *      tokens. A provider that ignores it bills full resolution and still
 *      returns a normal-looking 200 — there is no error to catch, the cost model
 *      just silently stops being true. This asserts the number they billed.
 *   2. THAT A REAL ANSWER PARSES. Strict json_schema is a promise from someone
 *      else. This checks it against our own zod on a real payload.
 *
 * Run once. Do not loop it.
 *
 *   RUN_LIVE_SMOKE=1 OPENAI_API_KEY=sk-... node scripts/live-smoke-extraction.mjs
 *
 * Exits 0 on PASS or SKIP, 1 on failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-live-smoke");
const FIXTURE = path.join(__dirname, "fixtures", "street-san-antonio-escazu.jpg");
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
        "../lib/extraction/client.ts",
        "../lib/extraction/extract.ts",
        "../lib/extraction/config.ts",
        "../lib/extraction/prompt.ts",
        "../lib/extraction/schema.ts",
        "../lib/capture/types.ts",
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

/**
 * gpt-5-nano pricing, USD per 1M tokens, as published 2026-07-16.
 * Override via env when it moves; the cost line is reporting, not an assertion.
 */
const PRICE_IN = Number(process.env.SMOKE_PRICE_IN ?? 0.05);
const PRICE_OUT = Number(process.env.SMOKE_PRICE_OUT ?? 0.4);

async function main() {
  compile();
  const { createOpenAiVisionClient } = require(path.join(BUILD_DIR, "extraction", "client.js"));
  const { extractFrame } = require(path.join(BUILD_DIR, "extraction", "extract.js"));
  const { MAX_INPUT_TOKENS_PER_FRAME } = require(path.join(BUILD_DIR, "extraction", "config.js"));
  const { systemPromptApproxTokens } = require(path.join(BUILD_DIR, "extraction", "prompt.js"));
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));

  // A data: URL, so the fixture the model sees is the fixture in the repo — no
  // hosting, no Supabase, no Wikimedia at run time. The billed image tokens come
  // from the resolution, not from how the bytes arrived.
  const bytes = readFileSync(FIXTURE);
  const imageUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  console.log(`\nlive smoke: ${model} on ${path.basename(FIXTURE)} (${(bytes.length / 1024).toFixed(0)} KB)`);
  console.log(`  static prefix ~${systemPromptApproxTokens()} tokens\n`);

  const client = createOpenAiVisionClient();
  const started = Date.now();
  const result = await extractFrame(client, imageUrl, model);
  const elapsedMs = Date.now() - started;

  if (result.kind === "overbudget") {
    // Not a test bug — this is the guard doing precisely its job, and it is the
    // single most important thing this script can tell us.
    check(
      `THE COST BREAKER FIRED: billed ${result.inputTokens} input tokens vs a ${MAX_INPUT_TOKENS_PER_FRAME} ceiling. detail:low is not being honoured.`,
      false,
    );
  } else if (result.kind === "failed") {
    check(`a real call returns a usable answer (got: ${result.reason})`, false);
  } else {
    const { usage, observation } = result;

    check(
      `input_tokens ${usage.inputTokens} < ${MAX_INPUT_TOKENS_PER_FRAME} — detail:low was honoured`,
      usage.inputTokens < MAX_INPUT_TOKENS_PER_FRAME,
      `(prompt ~${systemPromptApproxTokens()} + image)`,
    );
    check(
      "a real response parses against the strict schema and our zod",
      observation.schemaVersion === "cv-v1" &&
        Object.keys(observation.items).length === 15,
      `${Object.keys(observation.items).length} items`,
    );
    check(
      "every rubric item came back",
      T.RUBRIC_ITEM_KEYS.every((k) => observation.items[k] !== undefined),
    );
    check(
      "every item's value respects its response type",
      T.RUBRIC_ITEM_KEYS.every((k) => {
        const v = observation.items[k].value;
        if (v === null) return true;
        const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[k];
        if (rt === "boolean") return v === 0 || v === 1;
        if (rt === "scale_0_4") return Number.isInteger(v) && v >= 0 && v <= 4;
        return v >= 0 && v <= 100;
      }),
    );
    check(
      "confidences are in 0..1",
      T.RUBRIC_ITEM_KEYS.every((k) => {
        const c = observation.items[k].confidence;
        return typeof c === "number" && c >= 0 && c <= 1;
      }),
    );

    const cost =
      (usage.inputTokens / 1e6) * PRICE_IN + (usage.outputTokens / 1e6) * PRICE_OUT;

    console.log("\n  ---- what it actually cost ----");
    console.log(`  input_tokens   : ${usage.inputTokens}`);
    console.log(`  cached_tokens  : ${usage.cachedTokens}`);
    console.log(`  output_tokens  : ${usage.outputTokens}`);
    console.log(`  latency        : ${elapsedMs} ms`);
    console.log(`  cost this frame: $${cost.toFixed(6)}  (@ $${PRICE_IN}/1M in, $${PRICE_OUT}/1M out)`);
    console.log(`  400-frame run  : $${(cost * 400).toFixed(4)}`);
    console.log(`  usable         : ${observation.frameQuality.usable}${observation.frameQuality.reason ? ` (${observation.frameQuality.reason})` : ""}`);
    console.log("\n  ---- what it saw ----");
    for (const k of T.RUBRIC_ITEM_KEYS) {
      const it = observation.items[k];
      console.log(`  ${k.padEnd(20)} ${String(it.value).padStart(5)}  conf ${it.confidence}`);
    }
    console.log("");
  }

  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS — live extraction smoke");
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
