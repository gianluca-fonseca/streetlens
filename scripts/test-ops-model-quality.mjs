#!/usr/bin/env node
/**
 * test-ops-model-quality.mjs — pure aggregation for human-correction analytics.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-ops-quality");
const require = createRequire(import.meta.url);

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
        target: "es2019",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: ["../lib/ops/model-quality.ts", "../lib/capture/types.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
}

compile();
const { aggregateModelQuality, escalationRate } = require(path.join(BUILD_DIR, "ops", "model-quality.js"));

const rows = [
  {
    observationId: "cv-1",
    sessionId: "s1",
    segmentId: "seg-1",
    humanCorrected: true,
    overrides: { items: { 3: { curb_ramp: 1 }, 5: { sidewalk_width: 0.5 } }, baselineLenses: ["accessibility"] },
    model: "gpt-5-nano",
    createdAt: "2026-06-15T12:00:00Z",
  },
  {
    observationId: "cv-2",
    sessionId: "s2",
    segmentId: "seg-2",
    humanCorrected: false,
    overrides: {},
    model: "gpt-5-nano",
    createdAt: "2026-07-01T12:00:00Z",
  },
];

const summary = aggregateModelQuality(rows);
if (summary.byModel.length !== 1) throw new Error("expected one model row");
if (summary.byModel[0].correctionRate !== 0.5) throw new Error("correction rate");
if (escalationRate({ model: "x", total: 10, escalated: 2, inputTokens: 0, outputTokens: 0 }) !== 0.2) {
  throw new Error("escalation rate");
}

console.log("test-ops-model-quality: ok");
