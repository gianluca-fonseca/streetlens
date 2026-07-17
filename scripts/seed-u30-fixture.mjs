#!/usr/bin/env node
/**
 * seed-u30-fixture.mjs (u30 review loop)
 *
 * Seeds a review_ready camera walk into the LOCAL stores so the whole funnel —
 * admin queue → review page → approve → map → contributor status — can be driven
 * and screenshotted with no database.
 *
 * Why a script and not a committed sample: every file it writes is gitignored
 * runtime data, and the fixture must be reproducible rather than a mystery blob
 * in the repo. Run it, drive it, `--clean` it.
 *
 * It refuses to clobber real local data unless --force, exactly as
 * test-apply-submissions.mjs does: these paths are where a developer's own queue
 * lives.
 *
 * The two segment ids are REAL ids from data/demo-segments.geojson, so an
 * approved walk actually lands on findable streets on the map. That matters: a
 * made-up id would apply cleanly and then be invisible, and the drive would prove
 * nothing.
 *
 * Usage:
 *   node scripts/seed-u30-fixture.mjs [--force]
 *   node scripts/seed-u30-fixture.mjs --clean
 */

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");

/** Stable, so re-seeding is idempotent and the URL in evidence never moves. */
export const FIXTURE_SESSION_ID = "3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
const SUBMISSION_ID = "u30-fixture-cv-0001";

/** Real ids from the demo collection. */
const SEG_A = "esc-sa-0001";
const SEG_B = "esc-sa-0002";

const REVIEW_PATH = path.join(DATA, "capture-review.local.json");
const QUEUE_PATH = path.join(DATA, "pending-submissions.local.json");
const REVIEWS_PATH = path.join(DATA, "submission-reviews.local.json");
const APPROVED_PATH = path.join(DATA, "approved-submissions.local.json");
const OVERLAY_PATH = path.join(DATA, "capture-review-overlay.local.json");
const CV_PATH = path.join(DATA, "community-cv-observations.local.json");
const FRAME_SRC = path.join(ROOT, "scripts", "fixtures", "street-san-antonio-escazu.jpg");
const FRAME_DEST = path.join(PUBLIC, "u30-fixture-frame.jpg");

const WRITES = [REVIEW_PATH, QUEUE_PATH, REVIEWS_PATH, APPROVED_PATH, OVERLAY_PATH, CV_PATH];

function clean() {
  for (const f of [...WRITES, FRAME_DEST]) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`  removed ${path.relative(ROOT, f)}`);
    }
  }
  console.log("clean");
}

/** A frame, attributed to a segment. */
function frame(seq, segmentId) {
  return {
    seq,
    storagePath: `captures/${FIXTURE_SESSION_ID}/frame-${String(seq).padStart(4, "0")}.jpg`,
    segmentId,
    // Fixture-only: no bucket exists locally, so point at a local asset and get a
    // real filmstrip rather than a row of grey boxes.
    url: "/u30-fixture-frame.jpg",
  };
}

function median(value, confidence, frames) {
  return { value, confidence, frames };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--clean")) {
    clean();
    return;
  }

  const existing = WRITES.filter((f) => existsSync(f));
  if (existing.length > 0 && !args.includes("--force")) {
    console.error("Refusing to clobber existing local data:");
    for (const f of existing) console.error(`  ${path.relative(ROOT, f)}`);
    console.error("\nRe-run with --force to overwrite, or --clean to remove.");
    process.exit(1);
  }

  // Sanity: the ids must really exist, or an approved walk lands nowhere.
  const geo = JSON.parse(readFileSync(path.join(DATA, "demo-segments.geojson"), "utf8"));
  const ids = new Set(geo.features.map((f) => f.properties.id));
  for (const id of [SEG_A, SEG_B]) {
    if (!ids.has(id)) {
      console.error(`Fixture segment ${id} is not in demo-segments.geojson. Fix the seed.`);
      process.exit(1);
    }
  }

  mkdirSync(DATA, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });
  copyFileSync(FRAME_SRC, FRAME_DEST);

  const review = [
    {
      sessionId: FIXTURE_SESSION_ID,
      status: "review_ready",
      mode: "live",
      frameCount: 7,
      capturedOn: "2026-07-15T16:20:00.000Z",
      reviewedAt: null,
      // 5 done, 1 genuinely failed, 1 stopped for budget: the review page must
      // show those last two as DIFFERENT things.
      jobs: { pending: 0, done: 5, failed: 2, overbudget: 1 },
      tokens: { inputTokens: 6400, outputTokens: 910, observations: 5, escalated: 1 },
      rollups: [
        {
          segmentId: SEG_A,
          // drainage null on purpose: no frame supported that lens. It must
          // render as unset, never as a 0 that claims a failing street.
          scores: { overall: 62.5, accessibility: 41, drainage: null, shade: 58, bike: 30 },
          itemMedians: {
            sidewalk_present: median(1, 0.91, 3),
            sidewalk_width: median(0.5, 0.62, 3),
            curb_ramp: median(0, 0.74, 2),
            obstruction_free: median(0.25, 0.55, 3),
            lighting: median(0.5, 0.4, 2),
          },
          coverage: 0.75,
          confidence: 0.64,
          escalated: 1,
        },
        {
          segmentId: SEG_B,
          scores: { overall: 78, accessibility: 70, drainage: 66, shade: 81, bike: 45 },
          itemMedians: {
            sidewalk_present: median(1, 0.95, 2),
            sidewalk_width: median(0.75, 0.8, 2),
            curb_ramp: median(1, 0.88, 2),
          },
          coverage: 1,
          confidence: 0.86,
          escalated: 0,
        },
      ],
      frames: [
        frame(0, SEG_A),
        frame(1, SEG_A),
        frame(2, SEG_A),
        frame(3, SEG_B),
        frame(4, SEG_B),
        // Unattributed: matched no street. Counted, never hidden.
        frame(5, null),
        frame(6, null),
      ],
    },
  ];

  const queue = [
    {
      id: SUBMISSION_ID,
      type: "cv_capture",
      status: "pending",
      created_at: "2026-07-15T16:45:00.000Z",
      contact: null,
      payload: { session_id: FIXTURE_SESSION_ID },
      source_ip_hash: null,
      honeypot_tripped: false,
    },
  ];

  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n");
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
  // Start from an undecided state every time, so a re-seed is a real reset.
  writeFileSync(REVIEWS_PATH, JSON.stringify({}, null, 2) + "\n");
  writeFileSync(OVERLAY_PATH, JSON.stringify({}, null, 2) + "\n");
  writeFileSync(CV_PATH, JSON.stringify([], null, 2) + "\n");

  console.log("seeded a review_ready camera walk (local mode)");
  console.log(`  session:    ${FIXTURE_SESSION_ID}`);
  console.log(`  segments:   ${SEG_A}, ${SEG_B}`);
  console.log(`  queue row:  ${SUBMISSION_ID} (cv_capture, pending)`);
  console.log(`  frames:     7 (5 attributed, 2 unattributed), 1 failed + 1 overbudget`);
  console.log("\ndrive it:");
  console.log("  /en/admin/queue");
  console.log(`  /en/admin/capture/${FIXTURE_SESSION_ID}`);
  console.log(`  /en/collect/status/${FIXTURE_SESSION_ID}`);
}

main();
