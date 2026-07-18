#!/usr/bin/env node
/**
 * seed-provenance-drive.mjs (the unaudited-counter drive)
 *
 * Puts the LOCAL stores into exactly the state the owner reported: demo data off,
 * so every audited figure is honestly 0, and one real camera-observed street
 * carried through two reviewed sessions, plus one community add. That is the
 * state where the old UI showed nothing but zeros, and the state the provenance
 * line has to speak for.
 *
 * The rows mirror `buildCvObservations` (lib/apply-submissions.ts) field for
 * field, including the `cv-<session>-<segment>` id, so the store looks exactly as
 * it would after an admin approved the sessions. Everything it writes is
 * gitignored runtime data.
 *
 * Usage:
 *   node scripts/seed-provenance-drive.mjs          # seed
 *   node scripts/seed-provenance-drive.mjs --clean  # remove
 */

import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const CV_PATH = path.join(DATA, "community-cv-observations.local.json");
const SEGMENTS_PATH = path.join(DATA, "community-segments.local.json");

/** One REAL id from the committed collection, so the walk lands on a findable street. */
const SEGMENT = "esc-sa-0001";
const SESSION_A = "3f7a1c92-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
const SESSION_B = "8c1e4d05-2a9f-4b73-8e16-7d4f0a2b9c31";

function observation(sessionId, capturedOn, frames, scores, assessment) {
  return {
    id: `cv-${sessionId}-${SEGMENT}`,
    segment_id: SEGMENT,
    session_id: sessionId,
    scores,
    item_medians: {
      sidewalk_present: { value: 0.5, confidence: 0.72, frames: frames },
      curb_ramp: { value: 0.25, confidence: 0.64, frames: frames },
    },
    confidence: 0.68,
    coverage: 0.8,
    frame_refs: Array.from({ length: frames }, (_, i) =>
      `captures/${sessionId}/frame-${String(i).padStart(4, "0")}.jpg`,
    ),
    captured_on: capturedOn,
    source: "cv",
    submission_id: null,
    created_at: capturedOn,
    human_corrected: false,
    overrides: {},
    assessment,
  };
}

function main() {
  if (process.argv.includes("--clean")) {
    for (const f of [CV_PATH, SEGMENTS_PATH]) {
      if (existsSync(f)) {
        rmSync(f);
        console.log(`  removed ${path.relative(ROOT, f)}`);
      }
    }
    console.log("clean");
    return;
  }

  mkdirSync(DATA, { recursive: true });

  // Two sessions over the SAME street: cvSegments = 1, cvSessionsReviewed = 2 —
  // the singular and the plural in one line, which is the case the owner hit.
  //
  // The two walks are months apart and score differently on purpose (u32): this
  // is also the fixture for canonical selection, and a screenshot only proves
  // the newest walk is driving the panel if the older one would have looked
  // visibly different. Session A is listed FIRST while being the OLDER walk, so
  // the ordering cannot pass by accidentally taking the last row.
  writeFileSync(
    CV_PATH,
    JSON.stringify(
      [
        observation(
          SESSION_A,
          "2026-03-04T02:00:00.000Z",
          3,
          { overall: 54, accessibility: 41, drainage: 60, shade: 58, bike: 33 },
          "Broken sidewalk on the north side with a missing curb ramp at the corner.",
        ),
        observation(
          SESSION_B,
          "2026-07-16T02:00:00.000Z",
          2,
          { overall: 71, accessibility: 68, drainage: 74, shade: 58, bike: 45 },
          "Sidewalk has been repaved since the earlier pass and the corner now has a curb ramp.",
        ),
      ],
      null,
      2,
    ) + "\n",
  );

  // One community add, so the contribution counter has something to say too.
  writeFileSync(
    SEGMENTS_PATH,
    JSON.stringify(
      [
        {
          id: "community-drive-0001",
          name: "Calle sin nombre (community)",
          district: "San Antonio",
          source: "community",
          submitted_on: "2026-07-14T18:20:00.000Z",
          geometry: {
            type: "LineString",
            coordinates: [
              [-84.1567, 9.9231],
              [-84.1552, 9.9244],
            ],
          },
        },
      ],
      null,
      2,
    ) + "\n",
  );

  console.log("seeded the provenance drive state (local mode)");
  console.log(`  cv:        1 street (${SEGMENT}) over 2 sessions`);
  console.log("  community: 1 contribution");
  console.log("");
  console.log("drive it with NEXT_PUBLIC_SHOW_DEMO_DATA unset (audited figures 0):");
  console.log("  /en  /es  /en/map  /es/map");
}

main();
