#!/usr/bin/env node
/**
 * test-submission-history.mjs (u2 admin submission history)
 *
 * Locks getSubmissionHistory(), the data behind the admin history page:
 *   - EVERY reconciled record is returned, all statuses, INCLUDING a
 *     payload-invalid one (rendered honestly, never dropped — same doctrine the
 *     counters follow). So history rows and getSubmissionCounts agree.
 *   - Newest-first by created_at.
 *   - reviewed_at / reviewer_note follow the overlay-wins-over-raw precedence:
 *     an overlay entry supplies the decision metadata, and the raw row's own
 *     reviewed_at/reviewer_note are used only when there is no overlay.
 *   - A still-pending record has null reviewed_at and null reviewer_note.
 *
 * Compiles lib/submissions.ts to CJS (strict), seeds a local queue + overlay
 * fixture, checks the history output, and cleans up. Exits 0 PASS / 1 FAIL.
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
const BUILD_DIR = path.join(ROOT, ".test-build-history");
const DATA = path.join(ROOT, "data");
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

  const coords = [[-84.14, 9.912], [-84.139, 9.913]];
  const queue = [
    // Oldest: a valid pending add (no decision yet).
    {
      id: "h-pending",
      type: "add_segment",
      status: "pending",
      created_at: "2026-07-10T09:00:00.000Z",
      payload: { name: "Calle pendiente", highway: "residential", coordinates: coords },
    },
    // Middle: base-approved with the decision metadata ON the raw row (no
    // overlay). reviewed_at / reviewer_note must be read from the row.
    {
      id: "h-approved-row",
      type: "add_segment",
      status: "approved",
      created_at: "2026-07-11T09:00:00.000Z",
      reviewed_at: "2026-07-12T09:00:00.000Z",
      reviewer_note: "Approved from the row.",
      payload: { name: "Calle aprobada", highway: "residential", coordinates: coords },
    },
    // Newest: base-pending, but an overlay REJECTS it. The overlay's status,
    // reviewed_at, and reason must all win over the row's pending state.
    {
      id: "h-overlay-reject",
      type: "update_segment",
      status: "pending",
      created_at: "2026-07-13T09:00:00.000Z",
      payload: {
        segment_id: "seg-42",
        patch: { name: "Nuevo nombre" },
        reason: "El nombre estaba mal.",
      },
    },
    // A file-rejected record with an INVALID payload (empty name, one coord). It
    // must still appear in history, flagged unreadable — never silently dropped.
    {
      id: "h-invalid",
      type: "add_segment",
      status: "rejected",
      created_at: "2026-07-09T09:00:00.000Z",
      payload: { name: "", highway: "residential", coordinates: [[-84.14, 9.912]] },
    },
  ];
  await fs.writeFile(
    LOCAL_FILES[0],
    JSON.stringify(queue, null, 2),
    "utf8",
  );
  await fs.writeFile(
    LOCAL_FILES[1],
    JSON.stringify(
      {
        "h-overlay-reject": {
          status: "rejected",
          reason: "Duplicado de un tramo existente.",
          reviewed_at: "2026-07-14T09:00:00.000Z",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const { items, source, total, cap } = await submissions.getSubmissionHistory();
  console.log(`  -> source=${source} total=${total} cap=${cap} rows=${items.length}`);

  check("source is local", source === "local", `(${source})`);
  check("every record returned (total=4)", total === 4, `(${total})`);
  check("cap is 200", cap === 200, `(${cap})`);
  check("rows length matches total (nothing dropped)", items.length === 4, `(${items.length})`);

  // Rows must agree with the counters (the honesty invariant).
  const counts = await submissions.getSubmissionCounts();
  check(
    "history row count equals counts.total",
    items.length === counts.total,
    `(rows ${items.length} vs total ${counts.total})`,
  );

  // Newest-first ordering by created_at.
  const order = items.map((i) => i.id);
  check(
    "newest-first order",
    JSON.stringify(order) ===
      JSON.stringify(["h-overlay-reject", "h-approved-row", "h-pending", "h-invalid"]),
    JSON.stringify(order),
  );

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  // Overlay wins: status, reviewed_at, and note all come from the overlay.
  const ov = byId["h-overlay-reject"];
  check("overlay status wins (rejected)", ov.status === "rejected", `(${ov.status})`);
  check(
    "overlay reviewed_at wins",
    ov.reviewed_at === "2026-07-14T09:00:00.000Z",
    `(${ov.reviewed_at})`,
  );
  check(
    "overlay reason -> reviewer_note",
    ov.reviewer_note === "Duplicado de un tramo existente.",
    `(${ov.reviewer_note})`,
  );

  // Raw-row metadata is used when there is no overlay.
  const ar = byId["h-approved-row"];
  check("row reviewed_at used when no overlay", ar.reviewed_at === "2026-07-12T09:00:00.000Z", `(${ar.reviewed_at})`);
  check("row reviewer_note used when no overlay", ar.reviewer_note === "Approved from the row.", `(${ar.reviewer_note})`);

  // A still-pending record carries no decision metadata.
  const pd = byId["h-pending"];
  check("pending reviewed_at is null", pd.reviewed_at === null, `(${pd.reviewed_at})`);
  check("pending reviewer_note is null", pd.reviewer_note === null, `(${pd.reviewer_note})`);

  // The invalid-payload record survives, flagged unreadable.
  const inv = byId["h-invalid"];
  check("invalid record present", Boolean(inv));
  check("invalid record status rejected", inv.status === "rejected", `(${inv?.status})`);
  check("invalid record payloadValid=false", inv.payloadValid === false, `(${inv?.payloadValid})`);

  if (failures.length > 0) {
    console.error(`\nHISTORY-TEST FAIL — ${failures.length}:\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nHISTORY-TEST PASS");
  }
  } finally {
    await cleanup(LOCAL_FILES);
    cleanupIsolatedDataDir(isolatedDir);
  }
}

main()
  .catch((err) => {
    console.error("[test-history] crashed:", err);
    process.exitCode = 1;
  });
