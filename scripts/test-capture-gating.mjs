#!/usr/bin/env node
/**
 * test-capture-gating.mjs (u27 live recorder)
 *
 * Locks the recorder's decision core: the keep-or-drop gates, the two vision
 * measures they rest on, the distance maths, and the session manifest's shape
 * guard. These are the parts that decide what a walk actually yields, and they
 * are the parts with no UI to notice when they drift.
 *
 * Compiles components/capture/engine/*.ts to CJS (strict) and drives them
 * directly, same pattern as test-capture-schemas.mjs. Unlike that one, the
 * engine uses `@/` path aliases, so this writes a temporary tsconfig rather than
 * passing bare file arguments (tsc has no --paths CLI flag).
 *
 * Covers: haversine against a known distance, the both-gates rule (cadence AND
 * displacement), the lazy-gray perf contract, dedupe, blur, session caps, drop
 * tallies, segment open/close, and manifest recovery guards.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import Module from "node:module";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-capture-gating");
const TSCONFIG = path.join(ROOT, ".test-tsconfig-capture-gating.json");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** A flat gray thumbnail: zero edges, so zero Laplacian variance. */
function flat(size, value = 128) {
  return new Uint8Array(size * size).fill(value);
}

/** A checkerboard: maximal edges, so high Laplacian variance. */
function checker(size) {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) out[y * size + x] = (x + y) % 2 === 0 ? 0 : 255;
  }
  return out;
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });

  writeFileSync(
    TSCONFIG,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        lib: ["es2019"],
        types: [],
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
        rootDir: ".",
        outDir: path.relative(ROOT, BUILD_DIR),
      },
      files: [
        "components/capture/engine/tuning.ts",
        "components/capture/engine/frame-analysis.ts",
        "components/capture/engine/geo.ts",
        "components/capture/engine/gating.ts",
        "components/capture/engine/session.ts",
      ],
    }),
  );

  execFileSync("npx", ["tsc", "--project", TSCONFIG], { cwd: ROOT, stdio: "inherit" });

  // tsconfig `paths` resolves types only; tsc emits the `@/...` specifier into
  // the JS verbatim and expects a bundler to finish the job. There is no bundler
  // here, so the alias is taught to the CJS resolver instead. Scoped to this
  // process, which exits at the end of main().
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    const target = request.startsWith("@/") ? path.join(BUILD_DIR, request.slice(2)) : request;
    return resolveFilename.call(this, target, ...rest);
  };

  const base = path.join(BUILD_DIR, "components/capture/engine");
  const FA = require(path.join(base, "frame-analysis.js"));
  const GEO = require(path.join(base, "geo.js"));
  const G = require(path.join(base, "gating.js"));
  const S = require(path.join(base, "session.js"));
  const { CAPTURE_TUNING: TUNE } = require(path.join(base, "tuning.js"));

  const SIZE = TUNE.graySize;

  /* ---------------- Distance ---------------- */

  // Escazú town centre to a point ~1 km north. Reference computed independently
  // from the spherical law of cosines, so this is not the same formula grading
  // its own homework.
  const escazu = { lat: 9.9187, lng: -84.1408 };
  check(
    "haversine matches a known 1 km separation",
    near(GEO.haversineMeters(escazu, { lat: 9.92769, lng: -84.1408 }), 1_000, 2),
    `${GEO.haversineMeters(escazu, { lat: 9.92769, lng: -84.1408 }).toFixed(1)} m`,
  );
  check("haversine of a point with itself is zero", GEO.haversineMeters(escazu, escazu) === 0);
  check(
    "haversine is symmetric",
    near(
      GEO.haversineMeters(escazu, { lat: 9.93, lng: -84.15 }),
      GEO.haversineMeters({ lat: 9.93, lng: -84.15 }, escazu),
      1e-9,
    ),
  );

  const track = [
    { lat: 9.9187, lng: -84.1408, t: 1 },
    { lat: 9.91879, lng: -84.1408, t: 2 },
    { lat: 9.91888, lng: -84.1408, t: 3 },
  ];
  check(
    "track distance sums pairwise legs",
    near(GEO.trackDistanceMeters(track), 20, 1),
    `${GEO.trackDistanceMeters(track).toFixed(1)} m`,
  );
  check("track distance of a single fix is zero", GEO.trackDistanceMeters([track[0]]) === 0);
  check("track distance of an empty track is zero", GEO.trackDistanceMeters([]) === 0);

  check("distance formats metres under 1 km", GEO.formatDistance(840) === "840 m");
  check("distance formats km at and above 1 km", GEO.formatDistance(1_240) === "1.2 km");
  check("elapsed formats M:SS", GEO.formatElapsed(65_000) === "1:05");
  check("elapsed formats H:MM:SS past an hour", GEO.formatElapsed(3_725_000) === "1:02:05");

  /* ---------------- Frame analysis ---------------- */

  // Pure red: Rec.601 luma = 77/256 * 255 ≈ 76.
  check(
    "toGray applies Rec.601 luma weights",
    FA.toGray(new Uint8ClampedArray([255, 0, 0, 255]))[0] === 76,
    String(FA.toGray(new Uint8ClampedArray([255, 0, 0, 255]))[0]),
  );
  // The integer weights sum to exactly 256, so the shift preserves the full
  // range: white lands on 255 rather than 254. Worth pinning, since a weight
  // table that sums to 255 or 257 would silently compress or clip every frame.
  check(
    "toGray preserves the full range: white to 255, black to 0",
    FA.toGray(new Uint8ClampedArray([255, 255, 255, 255]))[0] === 255 &&
      FA.toGray(new Uint8ClampedArray([0, 0, 0, 255]))[0] === 0,
    String(FA.toGray(new Uint8ClampedArray([255, 255, 255, 255]))[0]),
  );
  check("toGray returns one byte per pixel", FA.toGray(new Uint8ClampedArray(4 * 9)).length === 9);

  check("frameDelta of identical frames is zero", FA.frameDelta(flat(SIZE), flat(SIZE)) === 0);
  check(
    "frameDelta with no previous frame is Infinity, so frame 1 always passes dedupe",
    FA.frameDelta(flat(SIZE), null) === Number.POSITIVE_INFINITY,
  );
  check(
    "frameDelta of a 10-level shift is 10",
    FA.frameDelta(flat(SIZE, 138), flat(SIZE, 128)) === 10,
  );
  check(
    "frameDelta guards a length mismatch instead of reading out of bounds",
    FA.frameDelta(flat(SIZE), flat(8)) === Number.POSITIVE_INFINITY,
  );

  check("laplacianVariance of a flat frame is zero", FA.laplacianVariance(flat(SIZE), SIZE) === 0);
  check(
    "laplacianVariance of a checkerboard is high",
    FA.laplacianVariance(checker(SIZE), SIZE) > TUNE.blurVariance,
    FA.laplacianVariance(checker(SIZE), SIZE).toFixed(0),
  );
  check(
    "laplacianVariance returns 0 for a frame with no interior",
    FA.laplacianVariance(flat(2), 2) === 0,
  );

  check(
    "fitDimensions never upscales a small sensor",
    JSON.stringify(FA.fitDimensions(640, 480, 1024)) === JSON.stringify({ width: 640, height: 480 }),
  );
  check(
    "fitDimensions clamps the longest side and preserves aspect",
    JSON.stringify(FA.fitDimensions(1920, 1080, 1024)) ===
      JSON.stringify({ width: 1024, height: 576 }),
  );
  check(
    "fitDimensions clamps portrait on its long side too",
    JSON.stringify(FA.fitDimensions(1080, 1920, 1024)) ===
      JSON.stringify({ width: 576, height: 1024 }),
  );

  /* ---------------- The gates ---------------- */

  const sharp = () => checker(SIZE);
  const at = (lat) => ({ lat, lng: -84.1408 });
  const FRESH = { lastKeptT: null, lastKeptPosition: null, prevGray: null };

  const first = G.evaluateFrame(
    { now: 1_000, position: at(9.9187), gray: sharp, graySize: SIZE },
    FRESH,
  );
  check("first frame of a session is kept without motion gates", first.keep === true);
  check("a kept frame reports its blur score", typeof first.blurScore === "number");

  check(
    "a frame with no GPS fix is dropped as no_fix",
    G.evaluateFrame({ now: 1_000, position: null, gray: sharp, graySize: SIZE }, FRESH).reason ===
      "no_fix",
  );

  // 9.9187 -> 9.91879 is ~10 m, comfortably past the 6 m displacement gate, so
  // these two cases isolate the cadence gate.
  const moved = { lastKeptT: 1_000, lastKeptPosition: at(9.9187), prevGray: null };
  check(
    "a frame too soon after the last keep is dropped as cadence",
    G.evaluateFrame(
      { now: 1_000 + TUNE.minIntervalMs - 1, position: at(9.91879), gray: sharp, graySize: SIZE },
      moved,
    ).reason === "cadence",
  );
  check(
    "a frame exactly at the cadence threshold passes it",
    G.evaluateFrame(
      { now: 1_000 + TUNE.minIntervalMs, position: at(9.91879), gray: sharp, graySize: SIZE },
      moved,
    ).keep === true,
  );

  check(
    "a stationary phone is dropped as displacement even after the interval",
    G.evaluateFrame(
      { now: 99_000, position: at(9.9187), gray: sharp, graySize: SIZE },
      moved,
    ).reason === "displacement",
  );

  // The both-gates rule: neither gate alone is sufficient.
  check(
    "time alone does not keep a frame",
    G.evaluateFrame({ now: 999_000, position: at(9.91871), gray: sharp, graySize: SIZE }, moved)
      .keep === false,
  );
  check(
    "distance alone does not keep a frame",
    G.evaluateFrame({ now: 1_100, position: at(9.92), gray: sharp, graySize: SIZE }, moved).keep ===
      false,
  );

  // The perf contract: pixel work must not happen on a frame the cheap gates
  // already rejected. This runs ~30x/sec on a phone that is also decoding video.
  let grayCalls = 0;
  const counted = () => {
    grayCalls += 1;
    return sharp();
  };
  G.evaluateFrame({ now: 1_001, position: at(9.91879), gray: counted, graySize: SIZE }, moved);
  check("cadence rejection never touches pixels", grayCalls === 0, `${grayCalls} calls`);
  G.evaluateFrame({ now: 99_000, position: at(9.9187), gray: counted, graySize: SIZE }, moved);
  check("displacement rejection never touches pixels", grayCalls === 0, `${grayCalls} calls`);
  G.evaluateFrame({ now: 99_000, position: at(9.91879), gray: counted, graySize: SIZE }, moved);
  check("a frame that clears the cheap gates does compute gray once", grayCalls === 1);

  check(
    "an identical consecutive frame is dropped as duplicate",
    G.evaluateFrame(
      { now: 99_000, position: at(9.91879), gray: () => flat(SIZE), graySize: SIZE },
      { ...moved, prevGray: flat(SIZE) },
    ).reason === "duplicate",
  );
  check(
    "a soft frame is dropped as blurry and still reports its score",
    (() => {
      const v = G.evaluateFrame(
        { now: 99_000, position: at(9.91879), gray: () => flat(SIZE), graySize: SIZE },
        moved,
      );
      return v.reason === "blurry" && typeof v.blurScore === "number";
    })(),
  );
  check(
    "a vision-gate drop returns gray so the caller need not recompute it",
    G.evaluateFrame(
      { now: 99_000, position: at(9.91879), gray: () => flat(SIZE), graySize: SIZE },
      moved,
    ).gray instanceof Uint8Array,
  );
  check(
    "a cheap-gate drop returns no gray",
    G.evaluateFrame({ now: 1_001, position: at(9.91879), gray: sharp, graySize: SIZE }, moved)
      .gray === null,
  );

  /* ---------------- Session caps ---------------- */

  const capArgs = { frameCount: 10, startedAt: 0, now: 1_000, maxFrames: 400 };
  check("a session under both caps keeps running", G.sessionCapReached(capArgs) === null);
  check(
    "the frame cap stops the session",
    G.sessionCapReached({ ...capArgs, frameCount: 400 }) === "frame_cap",
  );
  check(
    "the duration cap stops the session",
    G.sessionCapReached({ ...capArgs, now: TUNE.maxDurationMs }) === "duration_cap",
  );
  check(
    "the frame cap is checked against the value passed in, not a local copy",
    G.sessionCapReached({ ...capArgs, frameCount: 5, maxFrames: 5 }) === "frame_cap",
  );

  /* ---------------- Drop tallies ---------------- */

  const counts = G.emptyDropCounts();
  check(
    "emptyDropCounts covers every declared reason with zero",
    G.DROP_REASONS.every((r) => counts[r] === 0) &&
      Object.keys(counts).length === G.DROP_REASONS.length,
  );
  // Both are tallied by the recorder rather than returned by the gate: one is
  // only knowable after encoding, the other after touching the disk. They still
  // have to be declared, because the review screen renders every reason and an
  // undeclared one would surface as a missing i18n key.
  check(
    "oversize is a declared reason even though the gate never returns it",
    G.DROP_REASONS.includes("oversize"),
  );
  check(
    "write_failed is a declared reason even though the gate never returns it",
    G.DROP_REASONS.includes("write_failed"),
  );
  check(
    "no gate path can return a recorder-only reason",
    !["oversize", "write_failed"].includes(
      G.evaluateFrame({ now: 1_000, position: null, gray: sharp, graySize: SIZE }, FRESH).reason,
    ),
  );

  /* ---------------- Session manifest ---------------- */

  const m = S.createManifest("local-1", 5_000);
  check("a new manifest opens one segment", m.segments.length === 1 && m.segments[0].endedAt === null);
  check("a new manifest has no server session id yet", m.serverSessionId === null);

  const closed = S.closeSegment(m, 9_000);
  check("closeSegment closes the open segment", closed.segments[0].endedAt === 9_000);
  check("closeSegment does not mutate its input", m.segments[0].endedAt === null);

  const reopened = S.openSegment(closed, 10_000);
  check(
    "openSegment appends a new open segment after the closed one",
    reopened.segments.length === 2 &&
      reopened.segments[1].startedAt === 10_000 &&
      reopened.segments[1].endedAt === null,
  );
  check(
    "openSegment closes any still-open segment first",
    S.openSegment(m, 10_000).segments[0].endedAt === 10_000,
  );

  check("totalDropped sums every reason", S.totalDropped({ ...counts, blurry: 3, cadence: 4 }) === 7);

  const full = { ...m, frames: [{ seq: 0 }], track: [{}, {}] };
  check("a walk with frames and a two-fix track is recoverable", S.isRecoverable(full) === true);
  check("a walk with no frames is not recoverable", S.isRecoverable({ ...full, frames: [] }) === false);
  check(
    "a walk with a one-fix track is not recoverable, matching finalize's floor",
    S.isRecoverable({ ...full, track: [{}] }) === false,
  );
  check(
    "an already-uploaded walk is not offered for recovery",
    S.isRecoverable({ ...full, phase: "uploaded" }) === false,
  );

  check("isSessionManifest accepts a real manifest", S.isSessionManifest(m) === true);
  check("isSessionManifest rejects a foreign version", S.isSessionManifest({ ...m, version: 99 }) === false);
  check("isSessionManifest rejects null", S.isSessionManifest(null) === false);
  check(
    "isSessionManifest rejects a manifest missing a drop reason",
    S.isSessionManifest({ ...m, dropCounts: { blurry: 1 } }) === false,
  );
  check(
    "isSessionManifest rejects a truncated manifest",
    S.isSessionManifest({ ...m, frames: undefined }) === false,
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(TSCONFIG, { force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — recorder gating locked"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
