#!/usr/bin/env node
/**
 * test-submission-counts.mjs (advisor verification bar, u7, ruling 5)
 *
 * Locks the counter reconciliation: a file-status-rejected submission whose
 * payload FAILS validation (rejected precisely because it was malformed) and has
 * NO review-overlay entry must still be counted as rejected — the old code
 * dropped it (normalizeRecord returned null). It must also stay OUT of the
 * pending queue. Counts derive from ONE reconciled source.
 *
 * Compiles lib/submissions.ts to CJS (strict), seeds a local queue fixture, and
 * checks counts vs. the renderable queue. Cleans up. Exits 0 PASS / 1 FAIL.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupIsolatedDataDir,
  cleanupIsolatedDataDir,
  localDataPath,
} from "./lib/test-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-counts");
const require = createRequire(import.meta.url);

const LOCAL_FILE_NAMES = [
  "pending-submissions.local.json",
  "submission-reviews.local.json",
];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function cleanup(localFiles) {
  for (const f of localFiles) {
    try {
      await fs.rm(f, { force: true });
    } catch {
      /* ignore */
    }
  }
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

async function main() {
  const isolatedDir = setupIsolatedDataDir();
  const LOCAL_FILES = LOCAL_FILE_NAMES.map((name) => localDataPath(name));

  try {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.ADMIN_RPC_SECRET;

  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/submissions.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const submissions = require(path.join(BUILD_DIR, "submissions.js"));

  const now = new Date().toISOString();
  const queue = [
    // A valid pending add.
    {
      id: "c-pending-1",
      type: "add_segment",
      status: "pending",
      created_at: now,
      payload: {
        name: "Calle pendiente",
        highway: "residential",
        coordinates: [[-84.14, 9.912], [-84.139, 9.913]],
      },
    },
    // A valid approved record.
    {
      id: "c-approved-1",
      type: "add_segment",
      status: "approved",
      created_at: now,
      payload: {
        name: "Calle aprobada",
        highway: "residential",
        coordinates: [[-84.14, 9.912], [-84.139, 9.913]],
      },
    },
    // THE regression case (advisor seed abbdc33e): file-status rejected, no
    // overlay entry, and an INVALID payload (empty name, single coordinate).
    {
      id: "abbdc33e",
      type: "add_segment",
      status: "rejected",
      created_at: now,
      payload: { name: "", highway: "residential", coordinates: [[-84.14, 9.912]] },
    },
  ];
  await fs.writeFile(
    LOCAL_FILES[0],
    JSON.stringify(queue, null, 2),
    "utf8",
  );
  // Intentionally NO submission-reviews.local.json overlay.

  const counts = await submissions.getSubmissionCounts();
  console.log(`  -> counts ${JSON.stringify(counts)}`);
  check("pending = 1", counts.pending === 1, `(${counts.pending})`);
  check("approved = 1", counts.approved === 1, `(${counts.approved})`);
  check(
    "rejected = 1 (invalid-payload file-rejected record COUNTED)",
    counts.rejected === 1,
    `(${counts.rejected})`,
  );
  check("total = 3 (every record counted)", counts.total === 3, `(${counts.total})`);
  check(
    "buckets sum to total (no drift)",
    counts.pending + counts.approved + counts.rejected === counts.total,
  );

  // The renderable queue drops the invalid-payload record but the pending one shows.
  const { items: pending } = await submissions.getPendingSubmissions();
  check("pending queue has the valid pending item", pending.some((i) => i.id === "c-pending-1"));
  check(
    "pending queue EXCLUDES the rejected/invalid record",
    !pending.some((i) => i.id === "abbdc33e"),
  );

  const { items: renderable } = await submissions.getSubmissions();
  check(
    "renderable set excludes the invalid-payload record (payload can't render)",
    !renderable.some((i) => i.id === "abbdc33e"),
  );
  check(
    "yet counts still tallied it — proving counts != renderable set",
    counts.total === 3 && renderable.length === 2,
    `(renderable ${renderable.length})`,
  );

  if (failures.length > 0) {
    console.error(`\nCOUNTS-TEST FAIL — ${failures.length}:\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nCOUNTS-TEST PASS");
  }
  } finally {
    await cleanup(LOCAL_FILES);
    cleanupIsolatedDataDir(isolatedDir);
  }
}

main()
  .catch((err) => {
    console.error("[test-counts] crashed:", err);
    process.exitCode = 1;
  });
