#!/usr/bin/env node

/**
 * The sampling plan for an uploaded video.
 *
 * This is arithmetic, which is exactly why it is worth pinning. It does not
 * crash when it is wrong. It just quietly decides that two thirds of a walked
 * street will never be looked at, and every number downstream still adds up.
 *
 * The cap is a hard contract with the server (`CAPTURE_LIMITS.maxFrames`), so
 * the one thing that must never happen is a plan that exceeds it. The rest of
 * these checks are about the honesty of the coverage: a long video has to get
 * sparser rather than truncated, and the sampling grid must not sit on the
 * second boundary where it would align with keyframes.
 *
 * The rotation read is here for the same reason. A phone records the sensor's
 * landscape frame and a matrix saying "turn this 90 degrees"; a `<video>` element
 * obeys it and a raw `VideoDecoder` never sees it. Get it wrong and the WebCodecs
 * path emits a complete, correct-looking set of sideways JPEGs.
 *
 * Run: node scripts/test-video-plan.mjs
 */

import { execFileSync } from "node:child_process";
import Module from "node:module";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-video-plan");
const TSCONFIG = path.join(ROOT, ".test-tsconfig-video-plan.json");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function compile() {
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
        outDir: BUILD_DIR,
      },
      files: ["components/capture/engine/video-plan.ts", "lib/capture/types.ts"],
    }),
  );
  execFileSync("npx", ["tsc", "--project", TSCONFIG], { cwd: ROOT, stdio: "inherit" });
}

/**
 * tsc resolves `paths` for TYPES only. It emits the `@/...` specifier into the
 * JavaScript verbatim, expecting a bundler to finish the job, and there is no
 * bundler here. Same fix as scripts/test-capture-gating.mjs.
 */
function patchResolver() {
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    const target = request.startsWith("@/") ? path.join(BUILD_DIR, request.slice(2)) : request;
    return resolveFilename.call(this, target, ...rest);
  };
}

function main() {
  compile();
  patchResolver();

  const PLAN = require(path.join(BUILD_DIR, "components/capture/engine/video-plan.js"));
  const TYPES = require(path.join(BUILD_DIR, "lib/capture/types.js"));
  const { planExtraction, sampleTargetsMs, IDEAL_INTERVAL_MS, readRotation } = PLAN;
  const MAX = TYPES.CAPTURE_LIMITS.maxFrames;

  /* ---------------- The ideal case ---------------- */

  const short = planExtraction(60_000);
  check("a 60 s video samples at 1 fps", short.intervalMs === IDEAL_INTERVAL_MS, `got ${short.intervalMs}`);
  check("a 60 s video plans 60 frames", short.targetFrames === 60, `got ${short.targetFrames}`);
  check("a 60 s video is not marked sparser", short.sparser === false);

  const atCap = planExtraction(MAX * 1_000);
  check(
    "a video exactly at the cap stays at 1 fps",
    atCap.intervalMs === IDEAL_INTERVAL_MS && atCap.sparser === false,
    `interval ${atCap.intervalMs} sparser ${atCap.sparser}`,
  );
  check("a video exactly at the cap plans exactly the cap", atCap.targetFrames === MAX, `got ${atCap.targetFrames}`);

  /* ---------------- The cap is a hard contract ---------------- */

  // The whole point: a long video must never plan more frames than the server
  // will accept, at any duration.
  const durations = [
    20 * 60_000, // 20 min, the realistic long walk
    60 * 60_000, // an hour
    3 * 60 * 60_000, // absurd, but must still hold
    MAX * 1_000 + 1, // one millisecond past the cap
    MAX * 1_000 + 999,
  ];
  let capHeld = true;
  let capDetail = "";
  for (const d of durations) {
    const p = planExtraction(d);
    if (p.targetFrames > MAX) {
      capHeld = false;
      capDetail = `duration ${d} planned ${p.targetFrames}`;
      break;
    }
    if (sampleTargetsMs(p).length > MAX) {
      capHeld = false;
      capDetail = `duration ${d} emitted ${sampleTargetsMs(p).length} targets`;
      break;
    }
  }
  check("no duration ever plans past the frame cap", capHeld, capDetail);

  const long = planExtraction(20 * 60_000);
  check("a 20 min video is marked sparser", long.sparser === true);
  check("a 20 min video stretches past 1 s", long.intervalMs > IDEAL_INTERVAL_MS, `got ${long.intervalMs}`);
  check(
    "a 20 min video still covers the whole walk",
    // The last sample must land near the end, not seven minutes in. That is the
    // difference between sampling sparser and silently truncating.
    sampleTargetsMs(long).at(-1) > long.durationMs * 0.9,
    `last target ${sampleTargetsMs(long).at(-1)} of ${long.durationMs}`,
  );

  /* ---------------- Targets ---------------- */

  const targets = sampleTargetsMs(planExtraction(5_000));
  check("a 5 s video yields 5 targets", targets.length === 5, `got ${targets.length}`);
  check(
    "targets sit mid-interval, not on the second boundary",
    targets[0] === 500 && targets[1] === 1_500,
    `got ${targets.slice(0, 2).join(", ")}`,
  );
  check(
    "targets are strictly ascending",
    targets.every((t, i) => i === 0 || t > targets[i - 1]),
  );
  check(
    "no target falls outside the video",
    targets.every((t) => t >= 0 && t <= 5_000),
  );
  check(
    "no target is NaN",
    targets.every((t) => Number.isFinite(t)),
  );

  /* ---------------- Degenerate input ---------------- */

  const zero = planExtraction(0);
  check("a zero-length video plans nothing", zero.targetFrames === 0 && sampleTargetsMs(zero).length === 0);

  const sub = planExtraction(400);
  check("a sub-second video still gets its one frame", sub.targetFrames === 1, `got ${sub.targetFrames}`);

  const negative = planExtraction(-5_000);
  check("a negative duration plans nothing rather than throwing", negative.targetFrames === 0);

  // Blob-URL videos can report Infinity/NaN duration. A plan built from that
  // must not produce NaN targets that would later stamp NaN into a frame time.
  const infinite = planExtraction(Infinity);
  check(
    "an Infinity duration does not produce NaN",
    Number.isFinite(infinite.targetFrames) && sampleTargetsMs(infinite).every((t) => Number.isFinite(t)),
    `targetFrames ${infinite.targetFrames}`,
  );
  const nan = planExtraction(NaN);
  check("a NaN duration does not produce NaN", Number.isFinite(nan.targetFrames), `got ${nan.targetFrames}`);

  const tiny = planExtraction(10_000, 3);
  check("an injected cap is honoured", tiny.targetFrames <= 3, `got ${tiny.targetFrames}`);
  check("an injected cap marks sparser", tiny.sparser === true);

  /* ---------------- Which way is up ---------------- */

  // A phone writes the sensor's landscape frame plus a matrix saying "turn this".
  // Misread it and every frame of the walk is sideways, while every count, every
  // progress bar and every other test still reads correct.
  const ONE = 65536; // 16.16 fixed point 1.0, which is how a real tkhd stores it.
  const identity = [ONE, 0, 0, 0, ONE, 0, 0, 0, 1 << 30];
  const rot90 = [0, ONE, 0, -ONE, 0, 0, 0, 0, 1 << 30];
  const rot180 = [-ONE, 0, 0, 0, -ONE, 0, 0, 0, 1 << 30];
  const rot270 = [0, -ONE, 0, ONE, 0, 0, 0, 0, 1 << 30];

  check("an identity matrix is upright", readRotation(identity) === 0, `got ${readRotation(identity)}`);
  check("a portrait iPhone matrix reads 90", readRotation(rot90) === 90, `got ${readRotation(rot90)}`);
  check("an upside-down matrix reads 180", readRotation(rot180) === 180, `got ${readRotation(rot180)}`);
  check("the other quarter turn reads 270", readRotation(rot270) === 270, `got ${readRotation(rot270)}`);

  check(
    "fixed-point scale does not matter",
    // atan2 cancels the scale, so a matrix stored as plain 1s must read the same
    // as one stored in 16.16. Both appear in the wild.
    readRotation([0, 1, 0, -1, 0, 0, 0, 0, 1]) === 90,
  );
  check("an Int32Array matrix works", readRotation(Int32Array.from(rot90)) === 90);

  check("a missing matrix is upright, not a throw", readRotation(undefined) === 0);
  check("a null matrix is upright", readRotation(null) === 0);
  check("a truncated matrix is upright", readRotation([ONE]) === 0);
  // atan2(0,0) is 0, which would read as "upright" rather than as the absent
  // information it really is. Same answer, but it must not come from luck.
  check("an all-zero matrix is upright", readRotation([0, 0, 0, 0, 0, 0, 0, 0, 0]) === 0);
  check("a NaN matrix is upright", readRotation([NaN, NaN, 0, 0, 0, 0, 0, 0, 0]) === 0);

  // A camera only ever writes a right angle. An off-axis value means the matrix
  // is corrupt, and snapping it would rotate the whole walk on the strength of a
  // number we already know we do not understand.
  check(
    "an off-axis matrix is left alone rather than snapped",
    readRotation([Math.round(ONE * Math.cos(0.6)), Math.round(ONE * Math.sin(0.6))]) === 0,
  );
  check(
    "every rotation is one of the four legal values",
    [identity, rot90, rot180, rot270, undefined, [0, 0]].every((m) =>
      [0, 90, 180, 270].includes(readRotation(m)),
    ),
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(TSCONFIG, { force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — the plan never exceeds the cap, never truncates a walk, and knows which way is up"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
