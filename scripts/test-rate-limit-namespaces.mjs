#!/usr/bin/env node
/**
 * test-rate-limit-namespaces.mjs (u25)
 *
 * The capture funnel meters far harder than text submissions (opening a session
 * invites 400 uploads and a model bill), so lib/rate-limit.ts grew namespaces.
 *
 * The thing most worth pinning: the existing submissions limits are UNCHANGED
 * and the two namespaces cannot spend each other's tokens.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-rate-limit");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc", "lib/rate-limit.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs", "--moduleResolution", "node", "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const RL = require(path.join(BUILD_DIR, "rate-limit.js"));

  const T0 = 1_784_000_000_000;

  /* ---------------- Submissions: unchanged ---------------- */

  RL.resetRateLimits();
  check("submissions still allows 5 per minute", RL.RATE_LIMIT.capacity === 5 && RL.RATE_LIMIT.refillWindowMs === 60_000);
  {
    const results = Array.from({ length: 6 }, () => RL.consumeToken("ip-a", T0));
    check(
      "the 6th submission in a minute is blocked (unchanged)",
      results.slice(0, 5).every((r) => r.allowed) && !results[5].allowed,
      results.map((r) => (r.allowed ? "y" : "n")).join(""),
    );
    check("a blocked caller gets a Retry-After hint", results[5].retryAfterSec > 0);
  }
  RL.resetRateLimits();
  check("a null key is never rate-limited (no derivable IP)", RL.consumeToken(null, T0).allowed);

  /* ---------------- Capture: 3/hour ---------------- */

  RL.resetRateLimits();
  check("capture allows 3 per hour", RL.RATE_LIMITS.capture.capacity === 3 && RL.RATE_LIMITS.capture.refillWindowMs === 3_600_000);
  {
    const results = Array.from({ length: 4 }, () => RL.consumeNamespacedToken("capture", "ip-b", T0));
    check(
      "the 4th capture session in an hour is blocked",
      results.slice(0, 3).every((r) => r.allowed) && !results[3].allowed,
      results.map((r) => (r.allowed ? "y" : "n")).join(""),
    );
  }

  /* ---------------- Isolation ---------------- */

  RL.resetRateLimits();
  {
    // Exhaust capture for one origin; that origin must still be able to submit.
    for (let i = 0; i < 3; i++) RL.consumeNamespacedToken("capture", "ip-c", T0);
    check("capture is exhausted for this origin", !RL.consumeNamespacedToken("capture", "ip-c", T0).allowed);
    check(
      "the SAME origin can still post a text submission (namespaces are isolated)",
      RL.consumeToken("ip-c", T0).allowed,
    );
  }
  RL.resetRateLimits();
  {
    for (let i = 0; i < 5; i++) RL.consumeToken("ip-d", T0);
    check("submissions is exhausted for this origin", !RL.consumeToken("ip-d", T0).allowed);
    check(
      "the SAME origin can still open a capture session",
      RL.consumeNamespacedToken("capture", "ip-d", T0).allowed,
    );
  }
  RL.resetRateLimits();
  {
    for (let i = 0; i < 3; i++) RL.consumeNamespacedToken("capture", "ip-e", T0);
    check(
      "the ceiling is per-origin: another IP is unaffected",
      RL.consumeNamespacedToken("capture", "ip-f", T0).allowed,
    );
  }

  /* ---------------- Refill ---------------- */

  RL.resetRateLimits();
  {
    for (let i = 0; i < 3; i++) RL.consumeNamespacedToken("capture", "ip-g", T0);
    check("capture is blocked immediately after the 3rd", !RL.consumeNamespacedToken("capture", "ip-g", T0).allowed);
    check(
      "still blocked 20 minutes later (one token needs 20 min at 3/hour)",
      !RL.consumeNamespacedToken("capture", "ip-g", T0 + 19 * 60_000).allowed,
    );
    check(
      "a token is back after 21 minutes",
      RL.consumeNamespacedToken("capture", "ip-g", T0 + 21 * 60_000).allowed,
    );
    check(
      "a full hour restores the whole allowance",
      Array.from({ length: 3 }, () =>
        RL.consumeNamespacedToken("capture", "ip-h", T0 + 3_600_000),
      ).every((r) => r.allowed),
    );
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — rate-limit namespaces isolated, submissions unchanged"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
