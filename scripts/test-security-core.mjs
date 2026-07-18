#!/usr/bin/env node
/**
 * test-security-core.mjs (bgsd-0011 unit-security-core)
 *
 * Locks the application-side security contracts from 0025:
 *   - SUBMISSIONS_IP_SALT fail-closed in production
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-security-core");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(
    path.join(BUILD_DIR, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        rootDir: "..",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
      },
      include: ["../lib/ip.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "-p", path.join(BUILD_DIR, "tsconfig.json")], {
    cwd: ROOT,
    stdio: "inherit",
  });

  const ip = require(path.join(BUILD_DIR, "lib", "ip.js"));
  const prevEnv = { ...process.env };

  try {
    delete process.env.SUBMISSIONS_IP_SALT;
    process.env.NODE_ENV = "development";
    const devHash = ip.hashIp("203.0.113.1");
    check("dev mode falls back to the documented dev salt", typeof devHash === "string" && devHash.length === 64);

    process.env.NODE_ENV = "production";
    let threw = false;
    try {
      ip.hashIp("203.0.113.1");
    } catch (err) {
      threw = err instanceof Error && /SUBMISSIONS_IP_SALT/i.test(err.message);
    }
    check("production without SUBMISSIONS_IP_SALT throws", threw);

    process.env.SUBMISSIONS_IP_SALT = "unit-test-salt";
    const prodHash = ip.hashIp("203.0.113.1");
    process.env.SUBMISSIONS_IP_SALT = "other-salt";
    const otherHash = ip.hashIp("203.0.113.1");
    check("production with SUBMISSIONS_IP_SALT hashes normally", typeof prodHash === "string" && prodHash.length === 64);
    check("a different salt yields a different hash", prodHash !== otherHash);
  } finally {
    process.env = prevEnv;
    rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  console.log(
    failures.length === 0
      ? "\nPASS — security-core app contracts locked"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
