#!/usr/bin/env node
/**
 * eval-extraction.mjs — operator-run extraction agreement harness.
 *
 * Runs the real extraction prompt + downscale against a small labeled fixture
 * set (scripts/fixtures/extraction-eval.json) and reports per-item agreement.
 * Spends OpenAI tokens; NOT part of `npm test`.
 *
 *   npm run eval:extraction
 *   node --env-file=.env.local scripts/eval-extraction.mjs
 *   EVAL_MODEL=gpt-5.4-mini node --env-file=.env.local scripts/eval-extraction.mjs
 *   EVAL_OUT=.planning/evidence/unit-vision-acuity/eval-after.json \\
 *     node --env-file=.env.local scripts/eval-extraction.mjs
 *
 * Does NOT call the live database. Fixture labels are committed JSON; optional
 * local override files may be merged via EVAL_LABELS=path/to.json.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import {
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-eval-extraction");
const DEFAULT_LABELS = path.join(__dirname, "fixtures", "extraction-eval.json");
const require = createRequire(import.meta.url);

/** gpt-5-nano / mini approx USD per 1M tokens (reporting only). */
const PRICE_IN = Number(process.env.EVAL_PRICE_IN ?? 0.05);
const PRICE_OUT = Number(process.env.EVAL_PRICE_OUT ?? 0.4);
const PRICE_IN_MINI = Number(process.env.EVAL_PRICE_IN_MINI ?? 0.25);
const PRICE_OUT_MINI = Number(process.env.EVAL_PRICE_OUT_MINI ?? 2.0);

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
      return originalResolve.call(
        this,
        path.join(BUILD_DIR, request.slice("@/lib/".length)),
        ...rest,
      );
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function loadLabels() {
  const labelsPath = process.env.EVAL_LABELS
    ? path.resolve(ROOT, process.env.EVAL_LABELS)
    : DEFAULT_LABELS;
  if (!existsSync(labelsPath)) {
    throw new Error(`labels file missing: ${labelsPath}`);
  }
  const doc = JSON.parse(readFileSync(labelsPath, "utf8"));
  if (!Array.isArray(doc.fixtures) || doc.fixtures.length === 0) {
    throw new Error("labels file has no fixtures[]");
  }
  return { labelsPath, fixtures: doc.fixtures };
}

function priceFor(model, usage) {
  const mini = /mini|5\.4/i.test(model);
  const pin = mini ? PRICE_IN_MINI : PRICE_IN;
  const pout = mini ? PRICE_OUT_MINI : PRICE_OUT;
  return (usage.inputTokens * pin + usage.outputTokens * pout) / 1_000_000;
}

function compareExpect(expect, observation) {
  const rows = [];
  for (const [key, want] of Object.entries(expect)) {
    let got;
    if (key === "usable") {
      got = observation.frameQuality?.usable;
    } else {
      got = observation.items?.[key]?.value;
    }
    const agree = Object.is(got, want) || got === want;
    rows.push({ item: key, expect: want, got, agree });
  }
  return rows;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("FAIL — OPENAI_API_KEY is not set (use --env-file=.env.local)");
    process.exit(1);
  }

  compile();

  const { createOpenAiVisionClient } = require(
    path.join(BUILD_DIR, "extraction", "client.js"),
  );
  const { extractFrame } = require(path.join(BUILD_DIR, "extraction", "extract.js"));
  const { FRAME_MAX_EDGE_PX } = require(path.join(BUILD_DIR, "extraction", "downscale.js"));
  const { IMAGE_TOKEN_BUDGET, inputTokenCeiling, visionModel } = require(
    path.join(BUILD_DIR, "extraction", "config.js"),
  );
  const { systemPromptApproxTokens, staticRequestApproxTokens } = require(
    path.join(BUILD_DIR, "extraction", "prompt.js"),
  );

  const { labelsPath, fixtures } = loadLabels();
  const model = process.env.EVAL_MODEL || visionModel();
  const client = createOpenAiVisionClient();

  const report = {
    at: new Date().toISOString(),
    model,
    frameMaxEdgePx: FRAME_MAX_EDGE_PX,
    imageTokenBudget: IMAGE_TOKEN_BUDGET,
    inputTokenCeiling: inputTokenCeiling(),
    systemPromptApproxTokens: systemPromptApproxTokens(),
    staticRequestApproxTokens: staticRequestApproxTokens(),
    labelsPath: path.relative(ROOT, labelsPath),
    fixtures: [],
    agreement: { items: 0, agree: 0, byItem: {} },
    spendUsdApprox: 0,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
  };

  console.log(`\neval-extraction: ${fixtures.length} fixture(s), model=${model}`);
  console.log(`  downscale       ${FRAME_MAX_EDGE_PX} px`);
  console.log(`  image budget    ${IMAGE_TOKEN_BUDGET}`);
  console.log(`  ceiling         ${inputTokenCeiling()}`);
  console.log(`  static request  ~${staticRequestApproxTokens()} tokens`);
  console.log(`  labels          ${path.relative(ROOT, labelsPath)}\n`);

  for (const fix of fixtures) {
    const imagePath = path.join(__dirname, "fixtures", fix.image);
    if (!existsSync(imagePath)) {
      console.error(`  SKIP ${fix.id} — missing image ${fix.image}`);
      continue;
    }

    const bytes = readFileSync(imagePath);
    const imageUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    const started = Date.now();
    const result = await extractFrame(client, imageUrl, model);
    const elapsedMs = Date.now() - started;

    const entry = {
      id: fix.id,
      image: fix.image,
      vantage: fix.vantage ?? null,
      elapsedMs,
      kind: result.kind,
      model: result.model,
      usage: result.usage,
      spendUsdApprox: priceFor(model, result.usage),
      comparisons: [],
      observation: null,
    };

    report.usage.inputTokens += result.usage.inputTokens;
    report.usage.outputTokens += result.usage.outputTokens;
    report.usage.cachedTokens += result.usage.cachedTokens;
    report.spendUsdApprox += entry.spendUsdApprox;

    if (result.kind !== "ok") {
      console.log(`  [${fix.id}] ${result.kind}: ${result.reason ?? result.ceiling ?? "?"}`);
      report.fixtures.push(entry);
      continue;
    }

    entry.observation = {
      usable: result.observation.frameQuality.usable,
      reason: result.observation.frameQuality.reason ?? null,
      rationale: result.observation.rationale,
      items: Object.fromEntries(
        Object.entries(result.observation.items).map(([k, v]) => [
          k,
          { value: v.value, confidence: v.confidence },
        ]),
      ),
    };

    entry.comparisons = compareExpect(fix.expect ?? {}, result.observation);
    for (const row of entry.comparisons) {
      report.agreement.items += 1;
      if (row.agree) report.agreement.agree += 1;
      const bucket = (report.agreement.byItem[row.item] ??= { n: 0, agree: 0 });
      bucket.n += 1;
      if (row.agree) bucket.agree += 1;
    }

    const hit = entry.comparisons.filter((c) => c.agree).length;
    const total = entry.comparisons.length;
    console.log(
      `  [${fix.id}] ${hit}/${total} agree · in=${result.usage.inputTokens} ` +
        `cached=${result.usage.cachedTokens} · ~$${entry.spendUsdApprox.toFixed(4)} · ${elapsedMs}ms`,
    );
    for (const row of entry.comparisons) {
      console.log(
        `      ${row.agree ? "ok " : "MISS"} ${row.item}: expect=${JSON.stringify(row.expect)} got=${JSON.stringify(row.got)}`,
      );
    }

    report.fixtures.push(entry);
  }

  const rate =
    report.agreement.items === 0
      ? 0
      : report.agreement.agree / report.agreement.items;
  report.agreement.rate = Math.round(rate * 1000) / 1000;

  console.log("\n--- agreement ---");
  console.log(
    `  overall ${report.agreement.agree}/${report.agreement.items} (${(rate * 100).toFixed(1)}%)`,
  );
  for (const [item, s] of Object.entries(report.agreement.byItem)) {
    console.log(`  ${item}: ${s.agree}/${s.n}`);
  }
  console.log(
    `  spend ~$${report.spendUsdApprox.toFixed(4)} · input=${report.usage.inputTokens} ` +
      `output=${report.usage.outputTokens} cached=${report.usage.cachedTokens}`,
  );

  const outPath = process.env.EVAL_OUT
    ? path.resolve(ROOT, process.env.EVAL_OUT)
    : null;
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`  wrote ${path.relative(ROOT, outPath)}`);
  }

  // Exit 0 even on disagreement — this is a measurement tool, not a gate.
  // Exit 1 only on hard failures (no key, compile, etc.).
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
