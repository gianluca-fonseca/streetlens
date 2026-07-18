#!/usr/bin/env node
/**
 * test-data-dir.mjs — STREETLENS_DATA_DIR isolates local stores from repo data/.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-data-dir");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function main() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "streetlens-data-dir-"));
  process.env.STREETLENS_DATA_DIR = tempDir;

  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/data-dir.ts",
      "lib/community-store.ts",
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

  const { getDataDir } = require(path.join(BUILD_DIR, "data-dir.js"));
  const { COMMUNITY_SEGMENTS_PATH, appendCommunitySegments } = require(
    path.join(BUILD_DIR, "community-store.js"),
  );

  check("getDataDir honors STREETLENS_DATA_DIR", getDataDir() === tempDir);
  check(
    "community store path is under the isolated dir",
    COMMUNITY_SEGMENTS_PATH.startsWith(tempDir),
    COMMUNITY_SEGMENTS_PATH,
  );

  await appendCommunitySegments([
    {
      id: "iso-test-1",
      name: "ISOLATED",
      highway: "residential",
      district: "Escazú",
      source: "community",
      verified: false,
      auditor: null,
      submission_id: "iso-1",
      coordinates: [[-84.14, 9.912], [-84.139, 9.913]],
      community_report: null,
      created_at: "2026-07-18T00:00:00.000Z",
    },
  ]);

  check("writer created file in isolated dir", existsSync(COMMUNITY_SEGMENTS_PATH));
  check(
    "repo data/ was not touched",
    !existsSync(path.join(ROOT, "data", "community-segments.local.json")),
  );

  delete process.env.STREETLENS_DATA_DIR;
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nDATA-DIR TEST FAIL — ${failures.length}`);
    process.exit(1);
  }
  console.log("\nDATA-DIR TEST PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
