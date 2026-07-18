#!/usr/bin/env node
/**
 * test-assessment-schema.mjs — one Zod-validated SegmentAssessment shape.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-assessment");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const valid = {
  overall: "Sidewalk is uneven near the corner.",
  lenses: {
    accessibility: "a",
    drainage: "d",
    shade: "s",
    bike: "b",
  },
  adjustments: {
    accessibility: { delta: -3, reason: "trip hazard" },
  },
  adjustedScores: {
    overall: 55,
    accessibility: 41,
    drainage: null,
    shade: 58,
    bike: 30,
  },
  model: "gpt-5-nano",
};

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/assessment.ts",
      "--outDir",
      BUILD_DIR,
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--target",
      "es2019",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const { segmentAssessmentSchema, parseSegmentAssessment } = require(
    path.join(BUILD_DIR, "assessment.js"),
  );

  const ok = segmentAssessmentSchema.safeParse(valid);
  check("valid assessment passes safeParse", ok.success);

  const parsed = parseSegmentAssessment(valid);
  check("parseSegmentAssessment returns overall", parsed.overall === valid.overall);

  const bad = segmentAssessmentSchema.safeParse({ overall: 12 });
  check("malformed assessment fails safeParse", !bad.success);

  const drift = segmentAssessmentSchema.safeParse({
    ...valid,
    adjustments: { accessibility: { delta: "not-a-number", reason: "x" } },
  });
  check("non-numeric delta fails safeParse", !drift.success);

  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nASSESSMENT TEST FAIL — ${failures.length}`);
    process.exit(1);
  }
  console.log("\nASSESSMENT TEST PASS");
}

main();
