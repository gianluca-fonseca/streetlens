#!/usr/bin/env node
/**
 * test-matching-hmm.mjs (u26 HMM map matching)
 *
 * Drives the HMM matcher over synthetic tracks laid on the REAL network in
 * data/segments.geojson. Fixtures are real segment ids, picked by measuring the
 * network rather than by eye; the expected results are hardcoded here.
 *
 * The centrepiece is the parallel-street case: it asserts the HMM stays on the
 * street the walk was on AND that the naive baseline flips off it. Without that
 * second assertion the first one proves nothing — a matcher that always returns
 * the nearest street would pass it on easy geometry.
 *
 * Noise is a seeded PRNG: the matcher is deterministic, and so is its test.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-hmm");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------- *
 * Fixtures — real ids from data/segments.geojson.
 *
 * Chosen by measuring all 535 segments, not by inspection alone:
 *  STRAIGHT   233 m, sinuosity 1.000, nothing non-adjacent within 45 m of its
 *             middle 80% — a clean single-street case.
 *  PARALLEL_A/B  non-adjacent, 120 m of contiguous overlap at 12.4-17.8 m
 *             separation. NOTE: the seed asked for a 15-25 m pair; no pair in
 *             this network is flat-parallel in that band along a whole street
 *             (real block faces converge at their ends). This is the tightest
 *             sustained overlap that exists, i.e. strictly harder.
 *  L_FIRST/L_SECOND  share node L_NODE at a 96 degree turn.
 *  OFF_NETWORK  nearest segment 191 m away.
 * -------------------------------------------------------------- */
const STRAIGHT = "esc-sa-0170"; // Calle Avellana, 233 m
const PARALLEL_A = "esc-sa-0451"; // Calle Antigua, 162 m
const PARALLEL_B = "esc-sa-0196"; // Calle Monte Abajo, 296 m
const L_FIRST = "esc-sa-0090"; // Calle 138A Los Castro, 178 m
const L_SECOND = "esc-sa-0291"; // Avenida 38A, 123 m
const L_NODE = [-84.14219, 9.916591];
const OFF_NETWORK = [-84.1324, 9.904];

const T0 = 1_784_000_000_000;
const WALK_SPEED_MS = 1.4;

/* -------------------------------------------------------------- *
 * Geometry helpers (independent of the implementation under test)
 * -------------------------------------------------------------- */

const R = 6_371_008.8;
const toRad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function loadSegments() {
  const parsed = JSON.parse(readFileSync(path.join(ROOT, "data", "segments.geojson"), "utf8"));
  return parsed.features
    .filter((f) => f.geometry?.type === "LineString" && typeof f.properties?.id === "string")
    .map((f) => ({ id: f.properties.id, coordinates: f.geometry.coordinates }));
}

const SEGMENTS = loadSegments();
const byId = new Map(SEGMENTS.map((s) => [s.id, s]));

/** Cumulative distance table for a segment's vertices. */
function cumulativeOf(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return cum;
}

/** The position `loc` metres along a segment. */
function positionAt(id, loc) {
  const coords = byId.get(id).coordinates;
  const cum = cumulativeOf(coords);
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, loc));
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < clamped) i++;
  const span = cum[i + 1] - cum[i];
  const t = span > 0 ? (clamped - cum[i]) / span : 0;
  return [
    coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
    coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
  ];
}

function lengthOf(id) {
  const cum = cumulativeOf(byId.get(id).coordinates);
  return cum[cum.length - 1];
}

/** Deterministic PRNG — the matcher has no randomness and neither does its test. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller on a seeded uniform: repeatable Gaussian noise. */
function gaussianPair(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

/** Offset a position by (east, north) metres. */
function offsetMeters(pos, eastM, northM) {
  const dLat = northM / 110_540;
  const dLng = eastM / (111_320 * Math.cos(toRad(pos[1])));
  return [pos[0] + dLng, pos[1] + dLat];
}

/**
 * Walk a segment from `fromLoc` to `toLoc` at walking pace, one fix per second,
 * with Gaussian noise of `noiseM` standard deviation.
 */
function walkSegment(id, fromLoc, toLoc, startT, noiseM, seed) {
  const rand = mulberry32(seed);
  const dist = Math.abs(toLoc - fromLoc);
  const count = Math.max(2, Math.round(dist / WALK_SPEED_MS));
  const out = [];
  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1);
    const loc = fromLoc + (toLoc - fromLoc) * ratio;
    const truth = positionAt(id, loc);
    const [gx, gy] = gaussianPair(rand);
    const pos = noiseM > 0 ? offsetMeters(truth, gx * noiseM, gy * noiseM) : truth;
    out.push({ lng: pos[0], lat: pos[1], t: startT + i * 1000, speed: WALK_SPEED_MS });
  }
  return out;
}

/** One frame per second across a track's time span. */
function framesFor(track, startSeq = 0) {
  const out = [];
  const t0 = track[0].t;
  const tN = track[track.length - 1].t;
  for (let t = t0, seq = startSeq; t <= tN; t += 1000, seq++) out.push({ seq, t });
  return out;
}

const ids = (m) => m.traversals.map((t) => t.segmentId);

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  // lib/matching uses the "@/" path alias, and tsc rejects --paths on the CLI,
  // so the compile needs a real (throwaway) tsconfig.
  const tsconfig = path.join(BUILD_DIR, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: "..",
        paths: { "@/*": ["./*"] },
      },
      files: [
        "../lib/matching/hmm.ts",
        "../lib/matching/graph.ts",
        "../lib/matching/baseline.ts",
        "../lib/matching/types.ts",
        "../lib/capture/types.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
  const H = require(path.join(BUILD_DIR, "matching", "hmm.js"));
  const B = require(path.join(BUILD_DIR, "matching", "baseline.js"));

  /* ============ 1. Straight walk, 8 m noise ============ */
  console.log("\n1. straight walk down one street, 8 m Gaussian noise");
  {
    // The middle of the street: the ends are junctions, which test 3 covers.
    const track = walkSegment(STRAIGHT, 30, 200, T0, 8, 1234);
    const m = H.matchTrack(track, { segments: SEGMENTS });
    check(
      "a noisy straight walk yields exactly one traversal",
      m.traversals.length === 1,
      `got ${JSON.stringify(ids(m))}`,
    );
    check("...of the street actually walked", m.traversals[0]?.segmentId === STRAIGHT, `got ${m.traversals[0]?.segmentId}`);
    check(
      "traversal length is close to the 170 m walked (+/-15%)",
      Math.abs(m.traversals[0].lengthM - 170) / 170 < 0.15,
      `got ${m.traversals[0]?.lengthM.toFixed(1)} m`,
    );
    check("a fully matched track reports no unmatched spans", m.unmatchedSpans.length === 0);
    check("routeLine is a LineString on the network", m.routeLine.type === "LineString" && m.routeLine.coordinates.length >= 2);
  }

  /* ============ 2. Parallel streets — the regression guard ============ */
  console.log("\n2. parallel streets 12-18 m apart: HMM holds, baseline flips");
  {
    const track = walkSegment(PARALLEL_A, 0, 120, T0, 8, 99);
    const m = H.matchTrack(track, { segments: SEGMENTS });
    const hmmIds = new Set(ids(m));

    check(
      "the HMM stays on the street walked and never flips to the parallel one",
      hmmIds.has(PARALLEL_A) && !hmmIds.has(PARALLEL_B),
      `got ${JSON.stringify(ids(m))}`,
    );
    check(
      "the HMM does not shatter the pass into multiple traversals",
      m.traversals.length === 1,
      `got ${m.traversals.length}`,
    );

    // The guard: the same track through the naive matcher MUST flip. If the
    // baseline ever stops flipping here, this fixture stopped being a test of
    // anything and must be re-picked.
    const b = B.matchTrack(track, { segments: SEGMENTS });
    const baselineIds = new Set(ids(b));
    check(
      "the naive baseline DOES flip onto the parallel street (proves the fixture is hard)",
      baselineIds.has(PARALLEL_B),
      `baseline got ${JSON.stringify(ids(b))}`,
    );
  }

  /* ============ 3. L-shaped walk through a junction ============ */
  console.log("\n3. L-shaped walk through a junction");
  {
    const first = walkSegment(L_FIRST, 0, lengthOf(L_FIRST), T0, 5, 7);
    const secondStart = first[first.length - 1].t + 1000;
    const second = walkSegment(L_SECOND, 0, lengthOf(L_SECOND), secondStart, 5, 8);
    const track = [...first, ...second];
    const frames = framesFor(track);
    const m = H.matchTrack(track, { segments: SEGMENTS, frames });

    check(
      "an L-shaped walk yields two traversals",
      m.traversals.length === 2,
      `got ${JSON.stringify(ids(m))}`,
    );
    check(
      "...in the order they were walked",
      m.traversals[0]?.segmentId === L_FIRST && m.traversals[1]?.segmentId === L_SECOND,
      `got ${JSON.stringify(ids(m))}`,
    );
    check(
      "traversals are chronological",
      m.traversals.length === 2 && m.traversals[0].tEnter < m.traversals[1].tEnter,
    );
    check(
      "frames at the shared junction are flagged nearJunction",
      m.traversals.every((t) => t.nearJunctionSeqs.length > 0),
      `got ${m.traversals.map((t) => t.nearJunctionSeqs.length).join(" / ")}`,
    );
    check(
      "nearJunctionSeqs is always a subset of frameSeqs",
      m.traversals.every((t) => t.nearJunctionSeqs.every((s) => t.frameSeqs.includes(s))),
    );
    // A flagged frame must be near a junction of ITS OWN segment — which
    // includes each arm's far end, not only the corner they share. Checking
    // against L_NODE alone would wrongly call those a bug.
    const attribution = H.attributeFrames(m, frames);
    const endpointsOf = (id) => {
      const c = byId.get(id).coordinates;
      return [c[0], c[c.length - 1]];
    };
    let worstFlagged = 0;
    for (const traversal of m.traversals) {
      for (const seq of traversal.nearJunctionSeqs) {
        const frame = frames.find((f) => f.seq === seq);
        const i = track.findIndex((p) => p.t >= frame.t);
        const pos = [track[i].lng, track[i].lat];
        const nearest = Math.min(...endpointsOf(traversal.segmentId).map((e) => haversine(pos, e)));
        worstFlagged = Math.max(worstFlagged, nearest);
      }
    }
    check(
      "every flagged frame is genuinely near a junction of its own segment (<=35 m incl. GPS noise)",
      worstFlagged <= 35,
      `worst flagged frame is ${worstFlagged.toFixed(1)} m from its nearest junction`,
    );
    check(
      "mid-block frames are NOT flagged (the flag means something)",
      m.traversals.some((t) => t.frameSeqs.length > t.nearJunctionSeqs.length),
    );
    check("attributeFrames returns an entry for EVERY frame", attribution.size === frames.length);
  }

  /* ============ 4. Mid-track 60 s dropout ============ */
  console.log("\n4. mid-track 60 s GPS dropout");
  {
    // Walk the street, vanish for 60 s, resume further along it.
    const before = walkSegment(STRAIGHT, 30, 90, T0, 5, 21);
    const afterStart = before[before.length - 1].t + 60_000;
    const after = walkSegment(STRAIGHT, 150, 210, afterStart, 5, 22);
    const track = [...before, ...after];

    let m;
    let threw = null;
    try {
      m = H.matchTrack(track, { segments: SEGMENTS });
    } catch (err) {
      threw = err;
    }
    check("a dropout does not throw", threw === null, threw ? String(threw) : "");
    check(
      "the walk either side of the hole is still matched to the right street",
      m.traversals.length >= 1 && m.traversals.every((t) => t.segmentId === STRAIGHT),
      `got ${JSON.stringify(ids(m))}`,
    );
    check(
      "the dropout splits the track into two sub-trajectories rather than one bridged pass",
      m.traversals.length === 2,
      `got ${m.traversals.length} traversals`,
    );
    check(
      "the hole is reported as an unmatched span, not silently bridged",
      m.unmatchedSpans.length === 1 &&
        m.unmatchedSpans[0].tStart === before[before.length - 1].t &&
        m.unmatchedSpans[0].tEnd === after[0].t,
      JSON.stringify(m.unmatchedSpans),
    );
  }

  /* ============ 5. Entirely off-network ============ */
  console.log("\n5. track entirely off-network");
  {
    // A parking lot ~190 m from the nearest street.
    const track = [];
    for (let i = 0; i < 20; i++) {
      const pos = offsetMeters(OFF_NETWORK, i * 1.4, 0);
      track.push({ lng: pos[0], lat: pos[1], t: T0 + i * 1000, speed: WALK_SPEED_MS });
    }
    const m = H.matchTrack(track, { segments: SEGMENTS });
    check("an off-network track matches nothing", m.traversals.length === 0, `got ${JSON.stringify(ids(m))}`);
    check(
      "an off-network track reports one full unmatched span, not an error",
      m.unmatchedSpans.length === 1 &&
        m.unmatchedSpans[0].tStart === T0 &&
        m.unmatchedSpans[0].tEnd === T0 + 19_000,
      JSON.stringify(m.unmatchedSpans),
    );
    check("routeLine falls back to the raw fixes", m.routeLine.coordinates.length >= 2);
  }

  /* ============ 6. Per-frame attribution ============ */
  console.log("\n6. per-frame attribution along the L walk");
  {
    const first = walkSegment(L_FIRST, 0, lengthOf(L_FIRST), T0, 3, 7);
    const secondStart = first[first.length - 1].t + 1000;
    const second = walkSegment(L_SECOND, 0, lengthOf(L_SECOND), secondStart, 3, 8);
    const track = [...first, ...second];
    const frames = framesFor(track);
    const m = H.matchTrack(track, { segments: SEGMENTS, frames });
    const attribution = H.attributeFrames(m, frames);

    // Frames well inside each arm must land on that arm. Frames within 25 m of
    // the corner are excluded: which arm owns the corner is a coin-flip and not
    // what this asserts (that is what nearJunction is for).
    let firstArm = 0;
    let secondArm = 0;
    let wrong = 0;
    for (const frame of frames) {
      const i = track.findIndex((p) => p.t >= frame.t);
      const pos = [track[i].lng, track[i].lat];
      if (haversine(pos, L_NODE) < 25) continue;
      const expected = frame.t <= first[first.length - 1].t ? L_FIRST : L_SECOND;
      const got = attribution.get(frame.seq)?.segmentId;
      if (got !== expected) wrong++;
      else if (expected === L_FIRST) firstArm++;
      else secondArm++;
    }
    check("mid-block frames on both arms were attributed", firstArm > 10 && secondArm > 10, `${firstArm} / ${secondArm}`);
    check("no mid-block frame is attributed to the wrong arm", wrong === 0, `${wrong} wrong`);
    check(
      "every frame has an entry, and frames on the route are non-null",
      attribution.size === frames.length &&
        [...attribution.values()].filter((v) => v.segmentId !== null).length > frames.length * 0.8,
      `${[...attribution.values()].filter((v) => v.segmentId !== null).length}/${frames.length} attributed`,
    );
  }

  /* ============ Contract edge cases ============ */
  console.log("\n7. contract edge cases");
  {
    const m = H.matchTrack([], { segments: SEGMENTS });
    check(
      "an empty track returns an empty result rather than throwing",
      m.traversals.length === 0 && m.unmatchedSpans.length === 0 && m.routeLine.coordinates.length === 0,
    );
  }
  {
    const m = H.matchTrack(walkSegment(STRAIGHT, 30, 200, T0, 0, 1), { segments: [] });
    check("no candidate segments -> everything unmatched, no throw", m.traversals.length === 0 && m.unmatchedSpans.length === 1);
  }
  {
    const track = walkSegment(STRAIGHT, 30, 200, T0, 0, 1).map((f) => ({ ...f, t: T0 }));
    const m = H.matchTrack(track, { segments: SEGMENTS });
    check("fixes sharing one timestamp do not hang or throw", m.traversals.length <= 1, `${m.traversals.length} traversals`);
  }
  {
    // Out-of-order arrival: a paused-and-resumed recording.
    const track = walkSegment(STRAIGHT, 30, 200, T0, 3, 5);
    const shuffled = [track[10], track[0], ...track.slice(1, 10), ...track.slice(11)];
    const m = H.matchTrack(shuffled, { segments: SEGMENTS });
    check(
      "out-of-order fixes are sorted, not trusted",
      m.traversals.length === 1 && m.traversals[0].tEnter === track[0].t,
      `${m.traversals.length} traversals`,
    );
  }
  {
    // Every fix is junk: honest emptiness, not a guess.
    const track = walkSegment(STRAIGHT, 30, 200, T0, 0, 1).map((f) => ({ ...f, accuracy: 80 }));
    const m = H.matchTrack(track, { segments: SEGMENTS });
    check(
      "fixes with accuracy worse than the floor are dropped, leaving one unmatched span",
      m.traversals.length === 0 && m.unmatchedSpans.length === 1,
      `${m.traversals.length} traversals, ${m.unmatchedSpans.length} spans`,
    );
  }
  {
    // Determinism: same input, same output, twice.
    const track = walkSegment(PARALLEL_A, 0, 120, T0, 8, 99);
    const a = JSON.stringify(H.matchTrack(track, { segments: SEGMENTS }));
    const b = JSON.stringify(H.matchTrack(track, { segments: SEGMENTS }));
    check("matching is deterministic across calls", a === b);
  }

  console.log(
    `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failing check(s)` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
