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
  const { planExtraction, sampleTargetsMs, IDEAL_INTERVAL_MS } = PLAN;
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

  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(TSCONFIG, { force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — the sampling plan never exceeds the cap and never truncates a walk"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
