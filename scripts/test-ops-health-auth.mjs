#!/usr/bin/env node
/**
 * test-ops-health-auth.mjs — OPS_HEALTH_SECRET gate for /api/ops/health.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-ops-health");
const require = createRequire(import.meta.url);

rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });
writeFileSync(
  path.join(BUILD_DIR, "tsconfig.json"),
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
    files: ["../lib/ops/health-auth.ts", "../lib/timing-safe.ts"],
  }),
);
execFileSync("npx", ["tsc", "-p", path.join(BUILD_DIR, "tsconfig.json")], { cwd: ROOT, stdio: "inherit" });

const { verifyOpsHealthAuth } = require(path.join(BUILD_DIR, "ops", "health-auth.js"));

process.env.OPS_HEALTH_SECRET = "probe-secret-xyz";

if (verifyOpsHealthAuth(null, null)) throw new Error("should reject empty");
if (verifyOpsHealthAuth("Bearer wrong", null)) throw new Error("should reject wrong");
if (!verifyOpsHealthAuth("Bearer probe-secret-xyz", null)) throw new Error("should accept bearer");
if (!verifyOpsHealthAuth(null, "probe-secret-xyz")) throw new Error("should accept query");

console.log("test-ops-health-auth: ok");
