#!/usr/bin/env node
/**
 * test-quality-privacy.mjs (unit-quality-privacy)
 *
 * Locks bilingual assessment locale selection, evidence path selection, and
 * the scrub discipline that keeps frame_refs off the public wire.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-quality-privacy");
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
        "../lib/capture/schemas.ts",
        "../lib/segment-evidence.ts",
        "../lib/capture/storage.ts",
        "../lib/map-payload.ts",
        "../lib/cv-provenance.ts",
        "../lib/types.ts",
        "../lib/assessment.ts",
        "../lib/supabase.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });

  const Module = require("module");
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

async function main() {
  compile();
  const S = require(path.join(BUILD_DIR, "capture", "schemas.js"));
  const E = require(path.join(BUILD_DIR, "segment-evidence.js"));
  const P = require(path.join(BUILD_DIR, "map-payload.js"));
  const St = require(path.join(BUILD_DIR, "capture", "storage.js"));

  console.log("\nassessmentOverallForLocale");
  {
    const en = { overall: "English verdict." };
    const es = { overall: "Veredicto en español." };
    check("es locale prefers assessment_es", S.assessmentOverallForLocale(en, es, "es") === "Veredicto en español.");
    check("en locale uses assessment", S.assessmentOverallForLocale(en, es, "en") === "English verdict.");
    check("es falls back to EN when ES missing", S.assessmentOverallForLocale(en, null, "es") === "English verdict.");
    check("English-only rows still work", S.assessmentOverallForLocale(en, undefined, "es") === "English verdict.");
    check("malformed shapes return null", S.assessmentOverallForLocale("nope", null, "en") === null);
  }

  console.log("\nselectEvidencePaths");
  {
    const paths = E.selectEvidencePaths([
      [
        "captures/3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b/frame-0000.jpg",
        "captures/3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b/frame-0001.jpg",
        "not-a-path",
        "captures/3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b/frame-0002.jpg",
        "captures/3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b/frame-0003.jpg",
      ],
    ]);
    check("caps at three frames", paths.length === 3);
    check("rejects non-convention paths", !paths.includes("not-a-path"));
    check("preserves order", paths[0].endsWith("frame-0000.jpg") && paths[2].endsWith("frame-0002.jpg"));
  }

  console.log("\nscrub still strips frame_refs");
  {
    const scrubbed = P.scrubCvObservation({
      id: "cv-x",
      segment_id: "esc-sa-0001",
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      scores: { overall: 70, accessibility: 70, drainage: 70, shade: 70, bike: 70 },
      item_medians: {},
      confidence: 0.5,
      coverage: 0.5,
      frame_refs: ["captures/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/frame-0000.jpg"],
      captured_on: "2026-07-01T00:00:00.000Z",
      source: "cv",
      submission_id: null,
      created_at: "2026-07-01T00:00:00.000Z",
      assessment: { overall: "EN", lenses: { accessibility: "", drainage: "", shade: "", bike: "" }, adjustments: {}, adjustedScores: { overall: 70, accessibility: 70, drainage: 70, shade: 70, bike: 70 }, model: "m" },
      assessment_es: { overall: "ES", lenses: { accessibility: "", drainage: "", shade: "", bike: "" } },
    });
    check("session_id stripped", !("session_id" in scrubbed));
    check("frame_refs stripped", !("frame_refs" in scrubbed));
    check("frame_count set", scrubbed.frame_count === 1);
    check("assessment_es preserved on scrubbed wire", scrubbed.assessment_es?.overall === "ES");
  }

  console.log("\nstorage helpers");
  {
    check("FRAME_SIGNED_URL_TTL_SECONDS is short", St.FRAME_SIGNED_URL_TTL_SECONDS <= 300);
    check("publicFrameUrl still builds public path shape", (() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      try {
        return /\/object\/public\//.test(St.publicFrameUrl("captures/x/frame-0000.jpg"));
      } finally {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      }
    })());
  }

  console.log("\nmigration 0028 present");
  {
    const fs = require("node:fs");
    const sql = fs.readFileSync(
      path.join(ROOT, "supabase/migrations/0028_quality_privacy.sql"),
      "utf8",
    );
    check("adds assessment_es columns", /assessment_es/.test(sql));
    check(
      "flips bucket private",
      /public\s*=\s*false/.test(sql) || /'streetlens-frames',\s*false/.test(sql) || /, false, 2097152/.test(sql),
    );
    check("evidence-only select policy", /capture_frames_evidence_select/.test(sql));
    check("sections A and B present", /Locale-aware camera assessments/.test(sql) && /Private capture-frame bucket/.test(sql));
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll quality-privacy checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
