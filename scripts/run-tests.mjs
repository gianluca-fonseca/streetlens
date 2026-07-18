#!/usr/bin/env node
/**
 * run-tests.mjs — discover and run every scripts/test-*.mjs suite with one summary.
 *
 * Usage: npm test
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = __dirname;

const seedClean = path.join(SCRIPTS, "seed-provenance-drive.mjs");
if (existsSync(seedClean)) {
  try {
    execFileSync("node", [seedClean, "--clean"], { cwd: ROOT, stdio: "inherit" });
  } catch {
    /* non-fatal: nothing to clean */
  }
}

const suites = readdirSync(SCRIPTS)
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
  .sort();

if (suites.length === 0) {
  console.error("No test-*.mjs suites found.");
  process.exit(1);
}

const results = [];
let failed = false;

console.log(`Running ${suites.length} test suite(s)...\n`);

for (const suite of suites) {
  const started = Date.now();
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync("node", [path.join(SCRIPTS, suite)], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });
  const ms = Date.now() - started;
  const ok = r.status === 0;
  results.push({ suite, ok, ms, status: r.status ?? 1 });
  if (!ok) failed = true;
}

console.log("\n=== Test summary ===");
for (const { suite, ok, ms } of results) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${suite} (${ms}ms)`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);

process.exit(failed ? 1 : 0);
