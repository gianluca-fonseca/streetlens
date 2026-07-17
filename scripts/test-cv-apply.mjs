#!/usr/bin/env node
/**
 * test-cv-apply.mjs (u30 review loop)
 *
 * Locks the CV apply path against the one invariant the whole funnel rests on:
 * approving a camera walk NEVER mutates audit data. It drives the real
 * applyApprovedCaptureSession + the real getSegments/getStats, in local mode,
 * against the real 535-segment demo collection.
 *
 * What it proves:
 *   - an approved walk attaches CvObservations to REAL audited segments,
 *   - those segments keep their audited score_* byte-for-byte,
 *   - stats.segments stays 535 and the CV counts are tallied separately,
 *   - re-approving the same session upserts rather than duplicating,
 *   - unticking a segment RETRACTS it (the reason pruneCvObservations exists),
 *   - a null lens stays null and never becomes a zero.
 *
 * Mirrors test-apply-submissions.mjs: guard the real local files, force local
 * mode, compile the TS on the fly, drive the real functions.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const BUILD_DIR = path.join(ROOT, ".test-build-cv-apply");

const LOCAL_FILES = [
  path.join(ROOT, "data", "community-cv-observations.local.json"),
  path.join(ROOT, "data", "community-segments.local.json"),
  path.join(ROOT, "data", "community-reports.local.json"),
];

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "fail"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function cleanup() {
  for (const f of LOCAL_FILES) if (existsSync(f)) rmSync(f);
  rmSync(BUILD_DIR, { recursive: true, force: true });
}

/** Real ids from the demo collection, so an approval lands somewhere real. */
const SEG_A = "esc-sa-0001";
const SEG_B = "esc-sa-0002";
const SESSION = "3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

function observation(segmentId, overrides = {}) {
  return {
    segment_id: segmentId,
    scores: { overall: 62.5, accessibility: 41, drainage: null, shade: 58, bike: 30 },
    item_medians: { sidewalk_present: { value: 1, confidence: 0.9, frames: 3 } },
    coverage: 0.75,
    confidence: 0.64,
    frame_refs: [`captures/${SESSION}/frame-0000.jpg`],
    ...overrides,
  };
}

async function main() {
  // Refuse to clobber a real local store.
  const existing = LOCAL_FILES.filter((f) => existsSync(f));
  if (existing.length > 0) {
    console.error("Refusing to clobber real local data:");
    for (const f of existing) console.error(`  ${path.relative(ROOT, f)}`);
    process.exit(1);
  }

  // Force local mode: no Supabase, no secret.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.ADMIN_RPC_SECRET;

  execFileSync(
    "npx",
    [
      "tsc",
      "lib/apply-submissions.ts",
      "lib/segments.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const { applyApprovedCaptureSession, buildCvObservations } = require(
    path.join(BUILD_DIR, "apply-submissions.js"),
  );
  const { getSegments, getStats } = require(path.join(BUILD_DIR, "segments.js"));

  // The audited truth, before anything is approved.
  const before = await getSegments();
  const audited = before.features.find((f) => f.properties.id === SEG_A);
  const auditedScoresBefore = JSON.stringify(audited.properties);
  const statsBefore = await getStats();
  check("baseline: the demo collection is 535 audited segments", statsBefore.segments === 535, `(${statsBefore.segments})`);

  /* ---------------- Builders are pure and derive their ids ---------------- */
  console.log("\nbuilders");
  {
    const rows = buildCvObservations({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [observation(SEG_A)],
    });
    check("id derives from session + segment (so re-approving upserts)", rows[0].id === `cv-${SESSION}-${SEG_A}`, rows[0].id);
    check("source is cv", rows[0].source === "cv");
    check("captured_on is the WALK date, not the approval date", rows[0].captured_on === "2026-07-15T16:20:00.000Z");
    check("a null lens stays null (unknown is not zero)", rows[0].scores.drainage === null, JSON.stringify(rows[0].scores));
    // Provenance defaults: an untouched approval is pure CV.
    check("an untouched observation is not human_corrected", rows[0].human_corrected === false);
    check("an untouched observation carries an empty overrides record", JSON.stringify(rows[0].overrides) === "{}");
  }

  /* ---------------- Approving two segments ---------------- */
  console.log("\napprove two segments");
  {
    const res = await applyApprovedCaptureSession({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [observation(SEG_A), observation(SEG_B, { coverage: 1, confidence: 0.86 })],
    });
    check("applied locally", res.mode === "local" && res.kind === "cv_observation", JSON.stringify(res));
    check("two observations landed", res.ids.length === 2, JSON.stringify(res.ids));

    const after = await getSegments();
    const segA = after.features.find((f) => f.properties.id === SEG_A);
    check("the audited segment now carries cv_observations", (segA.properties.cv_observations ?? []).length === 1);
    check(
      "and its cv_observation keeps the null lens as null",
      segA.properties.cv_observations[0].scores.drainage === null,
    );

    // THE INVARIANT.
    const auditedFieldsAfter = { ...segA.properties };
    delete auditedFieldsAfter.cv_observations;
    check(
      "THE INVARIANT: the audited segment's own properties are untouched",
      JSON.stringify(auditedFieldsAfter) === auditedScoresBefore,
      `\n    before: ${auditedScoresBefore}\n    after:  ${JSON.stringify(auditedFieldsAfter)}`,
    );

    const untouched = after.features.find((f) => f.properties.id === "esc-sa-0003");
    check(
      "a segment the walk never saw carries no cv_observations",
      (untouched.properties.cv_observations ?? []).length === 0,
    );

    const stats = await getStats();
    check("stats.segments is STILL 535 (a camera pass is not an audit)", stats.segments === 535, `(${stats.segments})`);
    check("cvSessionsReviewed counts the session", stats.cvSessionsReviewed === 1, `(${stats.cvSessionsReviewed})`);
    check("cvSegments counts the covered segments", stats.cvSegments === 2, `(${stats.cvSegments})`);
    check("communitySegments is unaffected", stats.communitySegments === 0, `(${stats.communitySegments})`);
    check(
      "km/coverage/hero are untouched by CV",
      stats.km === statsBefore.km && stats.coveragePct === statsBefore.coveragePct && stats.heroPct === statsBefore.heroPct,
      JSON.stringify({ km: stats.km, coveragePct: stats.coveragePct, heroPct: stats.heroPct }),
    );
    check(
      "the collection gained NO features (CV attaches, it does not add segments)",
      after.features.length === before.features.length,
      `(${after.features.length} vs ${before.features.length})`,
    );
  }

  /* ---------------- Re-approving the same set is idempotent ---------------- */
  console.log("\nre-approve the same set");
  {
    await applyApprovedCaptureSession({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [observation(SEG_A), observation(SEG_B)],
    });
    const rows = JSON.parse(readFileSync(LOCAL_FILES[0], "utf8"));
    check("still exactly two rows (upsert, not duplicate)", rows.length === 2, `(${rows.length})`);
    const stats = await getStats();
    check("and the counts did not drift", stats.cvSegments === 2 && stats.cvSessionsReviewed === 1);
  }

  /* ---------------- Unticking a segment retracts it ---------------- */
  console.log("\nre-approve with one segment unticked");
  {
    // The case pruneCvObservations exists for: an upsert alone would leave SEG_B
    // published after an admin explicitly took it back.
    await applyApprovedCaptureSession({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [observation(SEG_A)],
    });
    const rows = JSON.parse(readFileSync(LOCAL_FILES[0], "utf8"));
    check("the retracted segment is gone from the store", rows.length === 1 && rows[0].segment_id === SEG_A, JSON.stringify(rows.map((r) => r.segment_id)));

    const after = await getSegments();
    const segB = after.features.find((f) => f.properties.id === SEG_B);
    check("and it no longer carries cv_observations on the map", (segB.properties.cv_observations ?? []).length === 0);
    const segA = after.features.find((f) => f.properties.id === SEG_A);
    check("while the still-ticked segment keeps its observation", (segA.properties.cv_observations ?? []).length === 1);

    const stats = await getStats();
    check("cvSegments follows the retraction", stats.cvSegments === 1, `(${stats.cvSegments})`);
    check("stats.segments is STILL 535", stats.segments === 535, `(${stats.segments})`);
  }

  /* ---------------- Human-corrected provenance rides the apply path ---------------- */
  console.log("\napprove a corrected segment alongside a pure-CV one");
  {
    const overrides = {
      items: { 0: { surface_condition: 0 } },
      excludedSeqs: [2],
      deletedSeqs: [],
      scores: { overall: 50 },
    };
    await applyApprovedCaptureSession({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [
        // SEG_A corrected by a reviewer; SEG_B left exactly as the model read it.
        observation(SEG_A, { human_corrected: true, overrides, scores: { overall: 50, accessibility: 41, drainage: null, shade: 58, bike: 30 } }),
        observation(SEG_B),
      ],
    });
    const rows = JSON.parse(readFileSync(LOCAL_FILES[0], "utf8"));
    const a = rows.find((r) => r.segment_id === SEG_A);
    const b = rows.find((r) => r.segment_id === SEG_B);
    check("the corrected segment persists human_corrected = true", a.human_corrected === true);
    check("the corrected segment persists the compact overrides record", JSON.stringify(a.overrides) === JSON.stringify(overrides));
    check("the untouched segment stays pure CV (not human_corrected)", b.human_corrected === false);
    check("the untouched segment carries an empty overrides record", JSON.stringify(b.overrides) === "{}");

    const after = await getSegments();
    const segA = after.features.find((f) => f.properties.id === SEG_A);
    check(
      "human_corrected reaches the map feature for the marker",
      segA.properties.cv_observations[0].human_corrected === true,
    );
    // The invariant still holds even for a corrected approval.
    const auditedFieldsAfter = { ...segA.properties };
    delete auditedFieldsAfter.cv_observations;
    check(
      "THE INVARIANT holds under correction: audited properties untouched",
      JSON.stringify(auditedFieldsAfter) === auditedScoresBefore,
    );
  }

  /* ---------------- Rejecting everything retracts everything ---------------- */
  console.log("\napprove nothing (a full retraction)");
  {
    await applyApprovedCaptureSession({
      session_id: SESSION,
      submission_id: "sub-1",
      captured_on: "2026-07-15T16:20:00.000Z",
      observations: [],
    });
    const rows = JSON.parse(readFileSync(LOCAL_FILES[0], "utf8"));
    check("the store is empty for that session", rows.length === 0, `(${rows.length})`);
    const stats = await getStats();
    check("the CV counts go back to zero", stats.cvSessionsReviewed === 0 && stats.cvSegments === 0);
    check("and the audited dataset is exactly where it started", stats.segments === 535 && stats.km === statsBefore.km);
  }
}

main()
  .catch((err) => {
    console.error(err);
    failures.push(String(err));
  })
  .finally(() => {
    cleanup();
    console.log(
      failures.length === 0
        ? "\nPASS — CV apply attaches, upserts, retracts, and never touches an audit"
        : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  });
