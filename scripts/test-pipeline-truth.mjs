#!/usr/bin/env node
/**
 * test-pipeline-truth.mjs (bgsd-0011 unit-pipeline-truth)
 *
 * Locks operational-truth mandates without a live database:
 *   - applyApprovedCaptureSession hard-fails when RPC fails (configured mode)
 *   - live read metadata marks degraded only when configured + failing
 *
 * Pause-reason persistence is covered in test-extraction-worker.mjs (cost breaker).
 * Migration RPCs are covered in test-capture-migrations.mjs (0025 block).
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const BUILD_DIR = path.join(ROOT, ".test-build-pipeline-truth");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "fail"}] ${label}${detail ? ` ${detail}` : ""}`);
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
        "../lib/apply-submissions.ts",
        "../lib/segments.ts",
        "../lib/supabase.ts",
        "../lib/demo-flag.ts",
        "../lib/community-store.ts",
        "../lib/types.ts",
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

async function main() {
  compile();

  const { applyApprovedCaptureSession } = require(path.join(BUILD_DIR, "apply-submissions.js"));
  const { getStats, getSegmentDataReadMeta } = require(path.join(BUILD_DIR, "segments.js"));

  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.ADMIN_RPC_SECRET = "secret";

    let threw = false;
    try {
      await applyApprovedCaptureSession({
        session_id: "00000000-0000-4000-8000-000000000001",
        submission_id: null,
        captured_on: new Date().toISOString(),
        observations: [],
      });
    } catch (err) {
      threw = true;
      check(
        "applyApprovedCaptureSession throws when RPC cannot run",
        /admin_apply_capture_session failed|fetch failed|ENOTFOUND|Failed/i.test(String(err)),
        String(err),
      );
    }
    check("applyApprovedCaptureSession does not fall through to local on RPC failure", threw);

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.ADMIN_RPC_SECRET;
  }

  {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await getStats();
    const meta = getSegmentDataReadMeta();
    check("unconfigured read is not degraded", meta.degraded === false);
    check("unconfigured scores source is static", meta.scoresSource === "static");
  }

  console.log(
    failures.length === 0
      ? "\nPASS — pipeline-truth invariants hold"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
