#!/usr/bin/env node
/**
 * seed-u2-fixture.mjs (u2 review inspector + overrides)
 *
 * Seeds a review_ready camera walk into the LOCAL stores with the FULL u2 shape:
 * every frame carries its model observation (15 rubric items + rationale +
 * escalation + model), its ground position, near_junction, and usable, and the
 * session carries a GPS track. That is what lets the inspector, the override
 * recompute, the curation controls, and the map panel all be driven and
 * screenshotted with no database — exactly as seed-u30-fixture.mjs did for the
 * plain review loop, one contract richer.
 *
 * Why a script and not a committed blob: every file it writes is gitignored
 * runtime data, and the fixture must be reproducible. Run it, drive it, --clean it.
 * It refuses to clobber real local data unless --force.
 *
 * The two segment ids are REAL ids from data/demo-segments.geojson, and the frame
 * dots sit on those segments' real geometry, so an approved walk lands on findable
 * streets and the map dots line up with the highlighted segments.
 *
 * Usage:
 *   node scripts/seed-u2-fixture.mjs [--force]
 *   node scripts/seed-u2-fixture.mjs --clean
 */

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");

/** Stable, so re-seeding is idempotent and the URL in evidence never moves. */
export const FIXTURE_SESSION_ID = "9c2e6a71-4f38-4a1b-b7d0-2e5a1c9f3b84";
const SUBMISSION_ID = "u2-fixture-cv-0001";

/** Real, contiguous ids from the demo collection. */
const SEG_A = "esc-sa-0001";
const SEG_B = "esc-sa-0002";

const REVIEW_PATH = path.join(DATA, "capture-review.local.json");
const QUEUE_PATH = path.join(DATA, "pending-submissions.local.json");
const REVIEWS_PATH = path.join(DATA, "submission-reviews.local.json");
const APPROVED_PATH = path.join(DATA, "approved-submissions.local.json");
const OVERLAY_PATH = path.join(DATA, "capture-review-overlay.local.json");
const CV_PATH = path.join(DATA, "community-cv-observations.local.json");
const FRAME_SRC = path.join(ROOT, "scripts", "fixtures", "street-san-antonio-escazu.jpg");
const FRAME_DEST = path.join(PUBLIC, "u2-fixture-frame.jpg");

const WRITES = [REVIEW_PATH, QUEUE_PATH, REVIEWS_PATH, APPROVED_PATH, OVERLAY_PATH, CV_PATH];

/** The 15 rubric items and their response encodings, mirrored from lib/capture/types.ts. */
const RESPONSE = {
  sidewalk_present: "boolean",
  sidewalk_width: "scale_0_4",
  surface_condition: "scale_0_4",
  curb_ramp: "boolean",
  obstruction_free: "scale_0_4",
  drain_present: "boolean",
  standing_water: "scale_0_4",
  curb_gutter: "scale_0_4",
  canopy_cover: "percent",
  midday_shade: "scale_0_4",
  lighting: "scale_0_4",
  crossing_safety: "scale_0_4",
  bike_lane_present: "boolean",
  bike_separation: "scale_0_4",
  bike_surface: "scale_0_4",
};

/** Encode a 0..1 "quality" into every item's native units, then apply overrides. */
function items(quality, confidence, overrides = {}) {
  const out = {};
  for (const [key, rt] of Object.entries(RESPONSE)) {
    let v;
    if (rt === "boolean") v = quality >= 0.5 ? 1 : 0;
    else if (rt === "percent") v = Math.round(quality * 100);
    else v = Math.round(quality * 4);
    out[key] = { value: v, confidence };
  }
  for (const [k, v] of Object.entries(overrides)) out[k] = v;
  return out;
}

function clean() {
  for (const f of [...WRITES, FRAME_DEST]) {
    if (existsSync(f)) {
      rmSync(f);
      console.log(`  removed ${path.relative(ROOT, f)}`);
    }
  }
  console.log("clean");
}

/** Linear interpolation between two [lng,lat] points. */
function lerp(a, b, t) {
  return { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t };
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

  // The ids must really exist, and we lift the frame dots off their real geometry.
  const geo = JSON.parse(readFileSync(path.join(DATA, "demo-segments.geojson"), "utf8"));
  const byId = new Map(geo.features.map((f) => [f.properties.id, f]));
  for (const id of [SEG_A, SEG_B]) {
    if (!byId.has(id)) {
      console.error(`Fixture segment ${id} is not in demo-segments.geojson. Fix the seed.`);
      process.exit(1);
    }
  }
  const coordsA = byId.get(SEG_A).geometry.coordinates;
  const coordsB = byId.get(SEG_B).geometry.coordinates;

  mkdirSync(DATA, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });
  copyFileSync(FRAME_SRC, FRAME_DEST);

  // Frame dots along the two segments, plus one off-network wanderer. Confidences
  // are chosen so the demos bite: seq 1 is a CONFIDENT poor reading that currently
  // sets segment A's median, so excluding it visibly lifts A's score; segment B has
  // two usable frames, so excluding both is what drops it (its last frame); seq 6 is
  // a blurred, not-usable frame that drags A's coverage without touching its medians.
  const OFF = { lng: coordsB[coordsB.length - 1][0] + 0.0012, lat: coordsB[coordsB.length - 1][1] + 0.0006 };
  const specs = [
    { seq: 0, segmentId: SEG_A, pos: lerp(coordsA[0], coordsA[1], 0.3), nearJunction: false, usable: true, quality: 0.7, conf: 0.45, escalated: false, model: "gpt-5-nano", rationale: "Sidewalk present and fairly clear mid-block; a utility pole narrows it slightly." },
    { seq: 1, segmentId: SEG_A, pos: lerp(coordsA[1], coordsA[2], 0.5), nearJunction: false, usable: true, quality: 0.2, conf: 0.9, escalated: false, model: "gpt-5-nano", rationale: "Clear view of a badly cracked, narrow walk with standing water at the gutter." },
    { seq: 2, segmentId: SEG_A, pos: { lng: coordsA[2][0], lat: coordsA[2][1] }, nearJunction: true, usable: true, quality: 0.4, conf: 0.66, escalated: true, model: "gpt-5", rationale: "At the corner: no curb ramp on this approach; crossing markings faded." },
    { seq: 3, segmentId: SEG_B, pos: lerp(coordsB[0], coordsB[1], 0.4), nearJunction: false, usable: true, quality: 0.85, conf: 0.9, escalated: false, model: "gpt-5-nano", rationale: "Wide, well-kept sidewalk with good canopy; drain present." },
    { seq: 4, segmentId: SEG_B, pos: lerp(coordsB[1], coordsB[2], 0.6), nearJunction: false, usable: true, quality: 0.55, conf: 0.7, escalated: false, model: "gpt-5-nano", rationale: "Sidewalk continues; surface a little uneven, some obstructions." },
    { seq: 5, segmentId: null, pos: OFF, nearJunction: false, usable: true, quality: 0.6, conf: 0.7, escalated: false, model: "gpt-5-nano", rationale: "Matched no street; likely a driveway off the network." },
    { seq: 6, segmentId: SEG_A, pos: lerp(coordsA[0], coordsA[1], 0.7), nearJunction: false, usable: false, quality: 0.0, conf: 0.15, escalated: false, model: "gpt-5-nano", rationale: "Motion blur — cannot assess this frame reliably." },
  ];

  const frames = specs.map((s) => ({
    seq: s.seq,
    storagePath: `captures/${FIXTURE_SESSION_ID}/frame-${String(s.seq).padStart(4, "0")}.jpg`,
    segmentId: s.segmentId,
    url: "/u2-fixture-frame.jpg",
    nearJunction: s.nearJunction,
    usable: s.usable,
    position: { lng: Number(s.pos.lng.toFixed(6)), lat: Number(s.pos.lat.toFixed(6)) },
    // seq 4 is usable:false but still HAS a reading (blurred, low confidence); the
    // rollup will down-weight it. A frame with no reading at all would be null here.
    observation: {
      items: items(s.quality, s.conf),
      rationale: s.rationale,
      escalated: s.escalated,
      model: s.model,
    },
    deleted: false,
  }));

  // A track that threads both segments — the polyline the map draws.
  const track = [
    { lng: coordsA[0][0], lat: coordsA[0][1] },
    { lng: coordsA[1][0], lat: coordsA[1][1] },
    { lng: coordsA[2][0], lat: coordsA[2][1] },
    { lng: coordsB[1][0], lat: coordsB[1][1] },
    { lng: coordsB[2][0], lat: coordsB[2][1] },
    OFF,
  ].map((p) => ({ lng: Number(p.lng.toFixed(6)), lat: Number(p.lat.toFixed(6)) }));

  // Rollups are cosmetic here: the review page derives the scored display from the
  // frames via the real recompute. They are left present and roughly consistent so
  // the payload still reads like a live one.
  const review = [
    {
      sessionId: FIXTURE_SESSION_ID,
      status: "review_ready",
      mode: "live",
      frameCount: 7,
      capturedOn: "2026-07-16T15:10:00.000Z",
      reviewedAt: null,
      jobs: { pending: 0, done: 6, failed: 1, overbudget: 0 },
      tokens: { inputTokens: 7100, outputTokens: 1020, observations: 7, escalated: 1 },
      rollups: [
        { segmentId: SEG_A, scores: { overall: 55, accessibility: 44, drainage: 40, shade: 48, bike: 45 }, itemMedians: {}, coverage: 0.66, confidence: 0.64, escalated: 1 },
        { segmentId: SEG_B, scores: { overall: 80, accessibility: 78, drainage: 70, shade: 82, bike: 60 }, itemMedians: {}, coverage: 0.5, confidence: 0.9, escalated: 0 },
      ],
      frames,
      track,
      tombstones: [],
    },
  ];

  const queue = [
    {
      id: SUBMISSION_ID,
      type: "cv_capture",
      status: "pending",
      created_at: "2026-07-16T15:30:00.000Z",
      contact: null,
      payload: { session_id: FIXTURE_SESSION_ID },
      source_ip_hash: null,
      honeypot_tripped: false,
    },
  ];

  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n");
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
  writeFileSync(REVIEWS_PATH, JSON.stringify({}, null, 2) + "\n");
  writeFileSync(OVERLAY_PATH, JSON.stringify({}, null, 2) + "\n");
  writeFileSync(CV_PATH, JSON.stringify([], null, 2) + "\n");

  console.log("seeded a review_ready camera walk with the full u2 shape (local mode)");
  console.log(`  session:    ${FIXTURE_SESSION_ID}`);
  console.log(`  segments:   ${SEG_A}, ${SEG_B}`);
  console.log(`  frames:     7 (5 attributed usable, 1 blurred, 1 unattributed), 1 escalated`);
  console.log(`  track:      ${track.length} vertices`);
  console.log("\ndrive it:");
  console.log(`  /en/admin/capture/${FIXTURE_SESSION_ID}`);
}

main();
