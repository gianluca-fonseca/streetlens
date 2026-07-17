#!/usr/bin/env node
/**
 * test-capture-schemas.mjs (u25 capture contracts)
 *
 * Locks the CV funnel's shared contracts — every later capture unit builds
 * against these, so a silent drift here is a four-unit bug.
 *
 * Compiles lib/capture/{types,schemas}.ts to CJS (strict) and drives them
 * directly, same pattern as test-parse-feature-props.mjs.
 *
 * Covers: the storage-path convention, the rubric-item vocabulary (exactly the
 * 15 v0.1 keys, in sync with scripts/generate-demo-audits.mjs), per-response-type
 * value encodings, boolean→0|1 normalization, null-as-not-assessable,
 * strict item set, track/frame validation, and the honeypot/limit contracts.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-capture-schemas");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** A valid observation, built fresh per case so mutations never leak. */
function observation(T, overrides = {}) {
  const items = {};
  for (const key of T.RUBRIC_ITEM_KEYS) {
    const rt = T.RUBRIC_ITEM_RESPONSE_TYPES[key];
    const value = rt === "boolean" ? 1 : rt === "percent" ? 42 : 3;
    items[key] = { value, confidence: 0.9 };
  }
  return {
    schemaVersion: "cv-v1",
    model: "gpt-5-mini",
    items,
    frameQuality: { usable: true },
    rationale: "Narrow paved street, no sidewalk either side; gutter at the right edge.",
    ...overrides,
  };
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/capture/types.ts",
      "lib/capture/schemas.ts",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--esModuleInterop", "--skipLibCheck", "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  // tsc infers rootDir = lib/capture from the inputs, so the emit is flat.
  const T = require(path.join(BUILD_DIR, "types.js"));
  const S = require(path.join(BUILD_DIR, "schemas.js"));

  const SID = "0b8a9a1e-0e6e-4c9a-9f0d-9a1f2b3c4d5e";

  /* ---------------- Storage path convention ---------------- */

  check(
    "frame path is zero-padded to 4 digits",
    T.captureFrameStoragePath(SID, 7) === `captures/${SID}/frame-0007.jpg`,
    T.captureFrameStoragePath(SID, 7),
  );
  check(
    "frame path pads the high end without truncating",
    T.captureFrameStoragePath(SID, 399) === `captures/${SID}/frame-0399.jpg`,
  );
  check(
    "frame paths sort lexicographically in capture order",
    [9, 100, 10, 1]
      .map((s) => T.captureFrameStoragePath(SID, s))
      .sort()
      .join() ===
      [1, 9, 10, 100].map((s) => T.captureFrameStoragePath(SID, s)).join(),
  );
  {
    let threw = false;
    try { T.captureFrameStoragePath(SID, -1); } catch { threw = true; }
    check("negative seq throws rather than producing frame--001.jpg", threw);
  }
  {
    let threw = false;
    try { T.captureFrameStoragePath(SID, 1.5); } catch { threw = true; }
    check("non-integer seq throws", threw);
  }
  check(
    "prefix matches the path's parent",
    T.captureFrameStoragePath(SID, 0).startsWith(`${T.captureStoragePrefix(SID)}/`),
  );

  /* ---------------- Rubric vocabulary in sync with the repo ---------------- */

  {
    // The generator is the rubric's source of truth; parse its keys straight out
    // of the file so a rubric edit that skips lib/capture fails HERE.
    const gen = readFileSync(path.join(ROOT, "scripts", "generate-demo-audits.mjs"), "utf8");
    const block = gen.slice(gen.indexOf("const RUBRIC_ITEMS = ["), gen.indexOf("];", gen.indexOf("const RUBRIC_ITEMS = [")));
    const genKeys = [...block.matchAll(/key:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
    const genTypes = [...block.matchAll(/response_type:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);

    check("parsed 15 rubric keys out of generate-demo-audits.mjs", genKeys.length === 15, `got ${genKeys.length}`);
    check(
      "RUBRIC_ITEM_KEYS matches the generator exactly, in order",
      JSON.stringify(genKeys) === JSON.stringify([...T.RUBRIC_ITEM_KEYS]),
      `\n    gen: ${JSON.stringify(genKeys)}\n    lib: ${JSON.stringify([...T.RUBRIC_ITEM_KEYS])}`,
    );
    const libTypes = genKeys.map((k) => T.RUBRIC_ITEM_RESPONSE_TYPES[k]);
    check(
      "response types match the generator item-for-item",
      JSON.stringify(genTypes) === JSON.stringify(libTypes),
      `\n    gen: ${JSON.stringify(genTypes)}\n    lib: ${JSON.stringify(libTypes)}`,
    );
    check(
      "every key has a scoring lens",
      genKeys.every((k) => typeof T.RUBRIC_ITEM_LAYERS[k] === "string"),
    );
  }

  /* ---------------- Observation: encodings ---------------- */

  {
    const out = S.captureObservationSchema.safeParse(observation(T));
    check("canonical observation parses", out.success, out.success ? "" : JSON.stringify(out.error.issues[0]));
  }
  {
    // A vision model asked a yes/no returns JSON true — normalize, don't reject.
    const o = observation(T);
    o.items.sidewalk_present.value = true;
    o.items.curb_ramp.value = false;
    const out = S.captureObservationSchema.safeParse(o);
    check(
      "boolean true/false normalizes to 1/0",
      out.success &&
        out.data.items.sidewalk_present.value === 1 &&
        out.data.items.curb_ramp.value === 0,
      out.success ? `-> ${out.data.items.sidewalk_present.value}/${out.data.items.curb_ramp.value}` : "parse failed",
    );
  }
  {
    const o = observation(T);
    o.items.sidewalk_present.value = 2; // boolean item, 0|1 only
    check("boolean item rejects 2", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    o.items.sidewalk_width.value = 5; // scale_0_4
    check("scale_0_4 rejects 5", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    o.items.sidewalk_width.value = 2.5;
    check("scale_0_4 rejects a non-integer", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    o.items.canopy_cover.value = 101; // percent
    check("percent rejects 101", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    o.items.canopy_cover.value = 37.5;
    const out = S.captureObservationSchema.safeParse(o);
    check("percent accepts a fractional value", out.success && out.data.items.canopy_cover.value === 37.5);
  }
  {
    // null is a real answer ("not assessable from this frame"), never a zero.
    const o = observation(T);
    o.items.curb_ramp.value = null;
    o.items.canopy_cover.value = null;
    o.items.lighting.value = null;
    const out = S.captureObservationSchema.safeParse(o);
    check(
      "null is accepted for every response type and stays null (never coerced to 0)",
      out.success &&
        out.data.items.curb_ramp.value === null &&
        out.data.items.canopy_cover.value === null &&
        out.data.items.lighting.value === null,
    );
  }
  {
    const o = observation(T);
    o.items.lighting.confidence = 1.4;
    check("confidence > 1 rejected", !S.captureObservationSchema.safeParse(o).success);
  }

  /* ---------------- Observation: strict item set ---------------- */

  {
    const o = observation(T);
    delete o.items.curb_ramp;
    check("a missing rubric item is rejected", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    o.items.sidewalk_colour = { value: 1, confidence: 0.5 };
    check("an invented rubric item is rejected", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T, { schemaVersion: "cv-v2" });
    check("wrong schemaVersion is rejected", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T);
    delete o.rationale;
    check("a missing per-frame rationale is rejected", !S.captureObservationSchema.safeParse(o).success);
  }
  {
    const o = observation(T, { rationale: "  a trimmed note  " });
    const out = S.captureObservationSchema.safeParse(o);
    check(
      "the rationale is trimmed and kept",
      out.success && out.data.rationale === "a trimmed note",
      out.success ? out.data.rationale : JSON.stringify(out.error.issues[0]),
    );
  }
  {
    const o = observation(T, { frameQuality: { usable: false, reason: "motion_blur" } });
    const out = S.captureObservationSchema.safeParse(o);
    check("unusable frame with a reason parses", out.success && out.data.frameQuality.reason === "motion_blur");
  }
  {
    // The model must not be able to assert attribution.
    const o = observation(T);
    o.segmentId = "esc-sa-0001";
    o.nearJunction = true;
    const out = S.captureObservationSchema.safeParse(o);
    check(
      "observation drops model-asserted attribution (segmentId/nearJunction)",
      out.success && out.data.segmentId === undefined && out.data.nearJunction === undefined,
    );
  }

  /* ---------------- Track ---------------- */

  const fix = (over = {}) => ({ lat: 9.9068, lng: -84.1512, t: 1_784_000_000_000, ...over });

  check("a two-fix track parses", S.trackSchema.safeParse([fix(), fix({ t: 1_784_000_001_000 })]).success);
  check("a one-fix track is rejected", !S.trackSchema.safeParse([fix()]).success);
  check(
    "seconds-since-epoch timestamp is rejected",
    !S.trackSchema.safeParse([fix({ t: 1_784_000_000 }), fix({ t: 1_784_000_001 })]).success,
  );
  check(
    "a fix outside Costa Rica is rejected",
    !S.trackSchema.safeParse([fix({ lat: 0, lng: 0 }), fix()]).success,
  );
  {
    const out = S.finalizeRequestSchema.safeParse({
      track: [fix(), fix({ t: 1_784_000_001_000 })],
      source: "gpx",
    });
    check("finalize defaults clockOffsetMs to 0", out.success && out.data.clockOffsetMs === 0);
  }
  check(
    "finalize rejects an implausible clock offset (> 1h)",
    !S.finalizeRequestSchema.safeParse({
      track: [fix(), fix({ t: 1_784_000_001_000 })],
      source: "live",
      clockOffsetMs: 7_200_000,
    }).success,
  );
  check(
    "finalize rejects an unknown track source",
    !S.finalizeRequestSchema.safeParse({
      track: [fix(), fix({ t: 1_784_000_001_000 })],
      source: "telepathy",
    }).success,
  );

  /* ---------------- Frame registration ---------------- */

  const frame = (seq, over = {}) => ({
    seq,
    t: 1_784_000_000_000 + seq * 1000,
    storagePath: T.captureFrameStoragePath(SID, seq),
    width: 1920,
    height: 1080,
    bytes: 500_000,
    ...over,
  });

  const regSchema = S.registerFramesRequestSchemaFor(SID);
  check("a valid frame batch parses", regSchema.safeParse({ frames: [frame(0), frame(1)] }).success);
  check(
    "a client-chosen storagePath is rejected",
    !regSchema.safeParse({ frames: [frame(0, { storagePath: `captures/${SID}/../../etc/passwd` })] }).success,
  );
  check(
    "a path belonging to ANOTHER session is rejected",
    !regSchema.safeParse({
      frames: [frame(0, { storagePath: T.captureFrameStoragePath("11111111-1111-4111-8111-111111111111", 0) })],
    }).success,
  );
  check("a duplicate seq within the batch is rejected", !regSchema.safeParse({ frames: [frame(0), frame(0)] }).success);
  check(
    "an oversized frame is rejected at the schema, not the bucket",
    !regSchema.safeParse({ frames: [frame(0, { bytes: T.CAPTURE_LIMITS.maxFrameBytes + 1 })] }).success,
  );
  check(
    "seq >= maxFrames is rejected",
    !regSchema.safeParse({ frames: [frame(0, { seq: T.CAPTURE_LIMITS.maxFrames })] }).success,
  );
  check("an empty batch is rejected", !regSchema.safeParse({ frames: [] }).success);

  /* ---------------- Session creation ---------------- */

  check("a session request parses", S.createSessionRequestSchema.safeParse({ mode: "live" }).success);
  check(
    "honeypot content is rejected by the schema",
    !S.createSessionRequestSchema.safeParse({ mode: "live", honeypot: "i-am-a-bot" }).success,
  );
  check("an unknown mode is rejected", !S.createSessionRequestSchema.safeParse({ mode: "telepathy" }).success);
  check(
    "maxFrameBytes stays in step with the bucket file_size_limit (2 MiB)",
    T.CAPTURE_LIMITS.maxFrameBytes === 2_097_152,
  );

  /* ---------------- Status ---------------- */

  check(
    "every declared status is accepted",
    T.CAPTURE_SESSION_STATUSES.every((s) => S.captureSessionStatusSchema.safeParse(s).success),
  );
  check("an unknown status is rejected", !S.captureSessionStatusSchema.safeParse("vibing").success);
  check(
    "uploadable statuses are a subset of all statuses",
    T.CAPTURE_UPLOADABLE_STATUSES.every((s) => T.CAPTURE_SESSION_STATUSES.includes(s)),
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — capture contracts locked"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
