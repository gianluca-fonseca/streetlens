#!/usr/bin/env node
/**
 * test-apply-submissions.mjs (advisor verification bar, u7)
 *
 * Exercises the SINGLE apply pipeline end-to-end through the admin approve path:
 *   - approve an add_segment fixture → the segment appears in the adapter output
 *     flagged community/unverified with NO rubric scores, and is counted
 *     separately (communitySegments), never inflating the official 535;
 *   - approve an update_segment fixture → a community report is attached to the
 *     target segment (never a score mutation).
 *
 * Compiles the lib data layer to CJS (strict, matching tsconfig) and drives it
 * with no Supabase env, so the local community store is used. Cleans up every
 * local file it writes. Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-apply");
const DATA = path.join(ROOT, "data");
const require = createRequire(import.meta.url);

const LOCAL_FILES = [
  path.join(DATA, "pending-submissions.local.json"),
  path.join(DATA, "submission-reviews.local.json"),
  path.join(DATA, "approved-submissions.local.json"),
  path.join(DATA, "community-segments.local.json"),
  path.join(DATA, "community-reports.local.json"),
];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function cleanup() {
  for (const f of LOCAL_FILES) {
    try {
      await fs.rm(f, { force: true });
    } catch {
      /* ignore */
    }
  }
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

async function main() {
  // Refuse to clobber a real local queue if one somehow exists.
  for (const f of LOCAL_FILES) {
    if (existsSync(f)) {
      throw new Error(`refusing to run: ${path.basename(f)} already exists`);
    }
  }

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.ADMIN_RPC_SECRET;
  // These invariants are about the published audited baseline (community/CV adds
  // never move the 535). That baseline only exists with demo data on, which is no
  // longer the default; pin it on so this suite tests the audited path.
  process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = "true";

  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/submissions.ts",
      "lib/segments.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const submissions = require(path.join(BUILD_DIR, "submissions.js"));
  const segments = require(path.join(BUILD_DIR, "segments.js"));

  // The committed canton overlay (esc-ce/esc-sr) merges into getSegments as
  // source:"import" neutral features; count it so the audited pilot (535) and
  // the always-on overlay are asserted apart.
  const importFile = path.join(ROOT, "data", "canton-import-segments.json");
  const importCount = existsSync(importFile)
    ? JSON.parse(readFileSync(importFile, "utf8")).length
    : 0;

  // Pick a real existing demo segment as the update target.
  const before = await segments.getSegments();
  const officialBefore = before.features.filter((f) => !f.properties.source).length;
  const targetId = before.features[0].properties.id;
  check("baseline official (audited) count is 535", officialBefore === 535, `(${officialBefore})`);
  check(
    "baseline collection = 535 audited + canton overlay",
    before.features.length === 535 + importCount,
    `(${before.features.length})`,
  );

  // Seed a pending queue: one add, one update.
  const now = new Date().toISOString();
  const queue = [
    {
      id: "t-add-1",
      type: "add_segment",
      status: "pending",
      created_at: now,
      payload: {
        name: "Calle de prueba comunitaria",
        highway: "residential",
        coordinates: [
          [-84.141, 9.9128],
          [-84.1405, 9.9134],
          [-84.1398, 9.9139],
        ],
        note: "Tramo faltante reportado por la comunidad.",
      },
    },
    {
      id: "t-upd-1",
      type: "update_segment",
      status: "pending",
      created_at: now,
      payload: {
        segment_id: targetId,
        patch: { name: "Nombre corregido" },
        reason: "El nombre no coincide con la señalización.",
      },
    },
  ];
  await fs.writeFile(
    path.join(DATA, "pending-submissions.local.json"),
    JSON.stringify(queue, null, 2),
    "utf8",
  );

  // Approve both through the real review→apply path.
  const rAdd = await submissions.reviewSubmission("t-add-1", "approve", "Verificado en mapa base.");
  const rUpd = await submissions.reviewSubmission("t-upd-1", "approve", "Corrección razonable.");
  check("approve add ok", rAdd.ok === true && rAdd.status === "approved");
  check("approve update ok", rUpd.ok === true && rUpd.status === "approved");

  // Adapter output after apply.
  const after = await segments.getSegments();
  const community = after.features.find((f) => f.properties.id === "com-t-add-1");
  check("community segment appears in adapter output", Boolean(community));
  if (community) {
    const p = community.properties;
    check("flagged source=community", p.source === "community");
    check("flagged verified=false", p.verified === false);
    check(
      "NO fabricated scores (all score_* === 0)",
      [p.score_overall, p.score_accessibility, p.score_drainage, p.score_shade, p.score_bike].every(
        (s) => s === 0,
      ),
    );
    check("carries a community_report from the note", Boolean(p.community_report && p.community_report.note));
    check("geometry is a LineString", community.geometry?.type === "LineString");
  }

  // Update → report attached to the TARGET segment (not the community add).
  const targetFeature = after.features.find((f) => f.properties.id === targetId);
  const reports = targetFeature?.properties?.community_reports ?? [];
  const upReport = reports.find((r) => r.id === "rep-t-upd-1");
  check("update_segment attached a community report to the target", Boolean(upReport));
  check(
    "report note is qualitative (not a score), carries the reason",
    Boolean(upReport && /señalización/.test(upReport.note)),
  );
  check(
    "target segment keeps its rubric scores (no mutation)",
    targetFeature.properties.score_overall === before.features[0].properties.score_overall,
  );

  // Stats: community counted separately; official 535 unchanged.
  const stats = await segments.getStats();
  console.log(`  -> stats ${JSON.stringify(stats)}`);
  check("official segments still 535", stats.segments === 535, `(${stats.segments})`);
  check("communitySegments counted separately (1)", stats.communitySegments === 1, `(${stats.communitySegments})`);
  check(
    "community add excluded from the audited count (still 535 with no source)",
    after.features.filter((f) => !f.properties.source).length === 535,
    `(${after.features.filter((f) => !f.properties.source).length})`,
  );
  check(
    "collection = 535 audited + canton overlay + 1 community add",
    after.features.length === 535 + importCount + 1,
    `(${after.features.length})`,
  );

  if (failures.length > 0) {
    console.error(`\nAPPLY-TEST FAIL — ${failures.length}:\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nAPPLY-TEST PASS");
  }
}

main()
  .catch((err) => {
    console.error("[test-apply] crashed:", err);
    process.exitCode = 1;
  })
  .finally(cleanup);
