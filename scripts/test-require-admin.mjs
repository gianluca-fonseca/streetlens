#!/usr/bin/env node
/**
 * test-require-admin.mjs — requireAdmin returns 401 without a valid session.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-require-admin");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function mockRequest(cookieValue) {
  return {
    cookies: {
      get: (name) =>
        cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    },
  };
}

async function main() {
  process.env.ADMIN_PASSWORD = "test-admin-password";

  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/admin-auth.ts",
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

  const { createSessionToken, requireAdmin } = require(
    path.join(BUILD_DIR, "admin-auth.js"),
  );

  const denied = await requireAdmin(mockRequest(undefined));
  check("missing cookie returns 401 response", denied?.status === 401);

  const token = await createSessionToken();
  const allowed = await requireAdmin(mockRequest(token));
  check("valid session returns null (proceed)", allowed === null);

  const bad = await requireAdmin(mockRequest("forged.token.here"));
  check("invalid token returns 401 response", bad?.status === 401);

  delete process.env.ADMIN_PASSWORD;
  rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`\nREQUIRE-ADMIN TEST FAIL — ${failures.length}`);
    process.exit(1);
  }
  console.log("\nREQUIRE-ADMIN TEST PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
