#!/usr/bin/env node
/**
 * test-map-payload-diet.mjs (bgsd-0011 unit-map-diet)
 *
 * Locks the paint-only public map payload and scrubbed detail response:
 * - getSegments paint features carry cv_count + score stubs, not cv_observations
 * - scrubCvObservation strips session_id and frame_refs, adds frame_count
 * - bounded fetch helper paginates past the 1000-row cliff
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
const BUILD_DIR = path.join(ROOT, ".test-build-map-payload");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/map-payload.ts",
      "lib/supabase-bounded.ts",
      "lib/cv-provenance.ts",
      "lib/types.ts",
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
}

async function main() {
  compile();
  const P = require(path.join(BUILD_DIR, "map-payload.js"));
  const B = require(path.join(BUILD_DIR, "supabase-bounded.js"));

  const obs = {
    id: "cv-sess-seg",
    segment_id: "esc-sa-0001",
    session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    scores: {
      overall: 72,
      accessibility: 70,
      drainage: 65,
      shade: 80,
      bike: 55,
    },
    item_medians: { sidewalk_width: { median: 0.5, confidence: 0.8, n: 3 } },
    confidence: 0.75,
    coverage: 0.6,
    frame_refs: ["captures/aaaa/frame-0001.jpg", "captures/aaaa/frame-0002.jpg"],
    captured_on: "2026-07-01T12:00:00.000Z",
    source: "cv",
    submission_id: null,
    created_at: "2026-07-02T12:00:00.000Z",
    human_corrected: false,
    overrides: {},
    assessment: { overall: "Fair sidewalk.", model: "gpt" },
  };

  console.log("\nscrub — privacy fields stripped from detail wire");
  {
    const scrubbed = P.scrubCvObservation(obs);
    check("session_id removed", !("session_id" in scrubbed));
    check("frame_refs removed", !("frame_refs" in scrubbed));
    check("frame_count present", scrubbed.frame_count === 2);
    check("scores preserved", scrubbed.scores.overall === 72);
    check("assessment preserved", scrubbed.assessment?.overall === "Fair sidewalk.");
  }

  console.log("\npaint — public FeatureCollection properties");
  {
    const feature = {
      type: "Feature",
      properties: {
        id: "esc-sa-0001",
        name: "Test St",
        district: "San Antonio",
        score_overall: 0,
        score_accessibility: 0,
        score_drainage: 0,
        score_shade: 0,
        score_bike: 0,
        audited_at: "",
        demo: false,
        source: "import",
        cv_observations: [obs],
        cv_count: 1,
        community_reports: [{ id: "r1", segment_id: "esc-sa-0001", note: "x" }],
      },
      geometry: { type: "LineString", coordinates: [[-84.1, 9.9], [-84.0, 9.9]] },
    };
    const cvBySegment = new Map([["esc-sa-0001", [obs]]]);
    const painted = P.toPaintFeature(feature, cvBySegment);
    const p = painted.properties;
    check("cv_observations stripped", p.cv_observations === undefined);
    check("community_reports stripped", p.community_reports === undefined);
    check("cv_count kept", p.cv_count === 1);
    check("canonical score stub on wire", p.cv_overall === 72);
    check("source kept for casing", p.source === "import");
  }

  console.log("\nbounded — pagination helper");
  {
    check("page size is 1000", B.SUPABASE_PAGE_SIZE === 1000);
    let calls = 0;
    const rows = await B.fetchAllPages("test", async (from) => {
      calls++;
      if (from === 0) return Array.from({ length: 1000 }, (_, i) => i);
      if (from === 1000) return [1000, 1001];
      return [];
    });
    check("fetches until short page", calls === 2);
    check("concatenates all pages", rows?.length === 1002);
  }

  console.log("");
  if (failures.length) {
    console.error(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("PASS — paint-only map payload and scrubbed detail contract locked.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
