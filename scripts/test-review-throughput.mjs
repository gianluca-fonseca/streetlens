#!/usr/bin/env node
/**
 * test-review-throughput.mjs — reviewer workbench throughput helpers (bgsd-0011).
 *
 * Locks pending-queue handoff, segment labels, draft persistence keys, and
 * actionable error key mapping. No database, no browser.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-review-throughput");
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
        "../lib/capture/queue-position.ts",
        "../lib/capture/segment-label.ts",
        "../lib/capture/review-draft.ts",
        "../lib/capture/review-errors.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
}

console.log("review-throughput helpers");
compile();

const {
  nextPendingSessionId,
  captureQueuePosition,
} = require(path.join(BUILD_DIR, "capture/queue-position.js"));
const {
  formatSegmentTitle,
  formatSegmentCaption,
  summarizeStreetNames,
} = require(path.join(BUILD_DIR, "capture/segment-label.js"));
const { reviewDraftKey } = require(path.join(BUILD_DIR, "capture/review-draft.js"));
const {
  captureReviewErrorKey,
  frameDeleteErrorKey,
  REASON_PRESET_KEYS,
} = require(path.join(BUILD_DIR, "capture/review-errors.js"));

const pending = ["aaa", "bbb", "ccc"];

check("next after middle", nextPendingSessionId(pending, "bbb") === "ccc");
check("next at end", nextPendingSessionId(pending, "ccc") === null);
check("next when current gone", nextPendingSessionId(pending, "gone") === "aaa");

const pos = captureQueuePosition(pending, "bbb");
check("queue position", pos?.position === 2 && pos?.total === 3 && pos?.remaining === 1);
check("queue position missing", captureQueuePosition(pending, "zzz") === null);

check(
  "segment title with name",
  formatSegmentTitle({ id: "esc-sr-1", name: "Calle Central", district: "San Rafael" }, "esc-sr-1") ===
    "Calle Central · esc-sr-1",
);
check(
  "segment caption with district",
  formatSegmentCaption({ id: "x", name: "Calle Roble", district: "San Antonio" }, "x") ===
    "Calle Roble · San Antonio",
);
check(
  "street summary overflow",
  summarizeStreetNames(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ],
    3,
  ) === "A, B, C +1",
);

check("draft key scoped", reviewDraftKey("sess-1") === "streetlens-review-draft:sess-1");
check("reason presets count", REASON_PRESET_KEYS.length === 4);

async function testErrors() {
  check(
    "409 maps to not reviewable",
    (await captureReviewErrorKey(new Response(JSON.stringify({ error: "not_reviewable" }), { status: 409 }))) ===
      "errorNotReviewable",
  );
  check(
    "422 dropped",
    (await captureReviewErrorKey(new Response(JSON.stringify({ error: "dropped_segments" }), { status: 422 }))) ===
      "errorDroppedSegments",
  );
  check(
    "401 unauthorized",
    (await captureReviewErrorKey(new Response("{}", { status: 401 }))) === "errorUnauthorized",
  );
  check("delete 401", frameDeleteErrorKey(new Response("{}", { status: 401 })) === "deleteErrorUnauthorized");
}

await testErrors();

if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS");
