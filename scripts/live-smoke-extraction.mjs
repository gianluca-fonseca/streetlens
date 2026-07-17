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
 *   1. THE BILLED TOKEN COUNT. This is how we learned `detail: "low"` is not
 *      honoured: it bills full resolution and still returns a normal-looking
 *      200, so there is no error to catch — the cost model just silently stops
 *      being true. The frame is now downscaled to 512 px before it is sent
 *      (lib/extraction/downscale.ts), and this asserts what they billed for it.
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
// The fixture is overridable so the same one real call can be pointed at either
// the honest street photo (street-real.jpg) or the pulpería control image. A
// path in SMOKE_FIXTURE (or argv[2]) wins; otherwise the historical default.
const FIXTURE_OVERRIDE = process.env.SMOKE_FIXTURE || process.argv[2];
const FIXTURE = FIXTURE_OVERRIDE
  ? path.resolve(ROOT, FIXTURE_OVERRIDE)
  : path.join(__dirname, "fixtures", "street-san-antonio-escazu.jpg");
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
        "../lib/extraction/downscale.ts",
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
  const { inputTokenCeiling, describeInputTokenCeiling, IMAGE_TOKEN_BUDGET } = require(
    path.join(BUILD_DIR, "extraction", "config.js"),
  );
  const { downscaleFrame, FRAME_MAX_EDGE_PX } = require(
    path.join(BUILD_DIR, "extraction", "downscale.js"),
  );
  const { systemPromptApproxTokens, staticRequestApproxTokens } = require(
    path.join(BUILD_DIR, "extraction", "prompt.js"),
  );
  const T = require(path.join(BUILD_DIR, "capture", "types.js"));

  const CEILING = inputTokenCeiling();

  // A data: URL, so the fixture the model sees is the fixture in the repo — no
  // hosting, no Supabase, no Wikimedia at run time. extractFrame downscales it
  // on the way out, exactly as it does for a real frame out of storage.
  const bytes = readFileSync(FIXTURE);
  const imageUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const model = process.env.OPENAI_VISION_MODEL || "gpt-5-nano";

  const sent = await downscaleFrame(imageUrl);

  console.log(`\nlive smoke: ${model} on ${path.basename(FIXTURE)} (${(bytes.length / 1024).toFixed(0)} KB)`);
  console.log(`  static prefix  ~${systemPromptApproxTokens()} tokens (cacheable)`);
  console.log(`  static request ~${staticRequestApproxTokens()} tokens (prompt + schema)`);
  console.log(`  sent as        ${(sent.length / 1024).toFixed(0)} KB, downscaled to ${FRAME_MAX_EDGE_PX} px`);
  console.log(`  ceiling        ${describeInputTokenCeiling()}\n`);

  const client = createOpenAiVisionClient();
  const started = Date.now();
  const result = await extractFrame(client, imageUrl, model);
  const elapsedMs = Date.now() - started;

  if (result.kind === "overbudget") {
    // Not a test bug — this is the guard doing precisely its job, and it is the
    // single most important thing this script can tell us.
    check(
      `THE COST BREAKER FIRED: billed ${result.inputTokens} input tokens vs a ceiling of ${result.ceiling}. Even a 512 px image is being billed above budget.`,
      false,
    );
  } else if (result.kind === "failed") {
    check(`a real call returns a usable answer (got: ${result.reason})`, false);
  } else {
    const { usage, observation } = result;

    check(
      `input_tokens ${usage.inputTokens} <= ${CEILING} — the bill is bounded`,
      usage.inputTokens <= CEILING,
      `(${CEILING - usage.inputTokens} tokens of headroom)`,
    );
    // The static request is the floor of any correct call, so what is left is
    // what the image cost — approximately, since the estimate runs ~10% high.
    // Approximate is enough: the failure this catches is an order of magnitude,
    // not a rounding error.
    check(
      `the ${FRAME_MAX_EDGE_PX} px image is not billed like a full-resolution one`,
      usage.inputTokens < staticRequestApproxTokens() + IMAGE_TOKEN_BUDGET,
      `billed ${usage.inputTokens} vs ~${staticRequestApproxTokens()} static + ${IMAGE_TOKEN_BUDGET} image budget`,
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
    check(
      // The contract is "rationale is a present string"; empty is tolerated on
      // purpose (a terse note must never fail a paid frame). So this asserts the
      // wire shape and REPORTS whether the model actually wrote anything, rather
      // than failing the whole smoke on an empty note.
      "a per-frame rationale field came back as a string",
      typeof observation.rationale === "string",
      observation.rationale.trim().length > 0
        ? `${observation.rationale.length} chars`
        : "EMPTY — the model returned no rationale text on this frame",
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
    console.log(`  rationale      : ${observation.rationale}`);
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
