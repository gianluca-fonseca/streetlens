#!/usr/bin/env node
/**
 * test-matching-baseline.mjs (u25 capture contracts)
 *
 * Drives the BASELINE map matcher over synthetic tracks with known ground
 * truth. The point is not that the baseline is good — it is knowingly weak (see
 * lib/matching/baseline.ts) — but that the CONTRACT in lib/matching/types.ts
 * holds, so unit-hmm-map-matching can drop in a real matcher against a fixed
 * target. These cases should pass for the HMM too.
 *
 * Geometry is a synthetic 2x2 grid near San Antonio de Escazu, so the test
 * never depends on data/segments.geojson staying byte-identical.
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
const BUILD_DIR = path.join(ROOT, ".test-build-matching");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------- *
 * Synthetic network — a 2x2 grid, ~9.906 N / -84.151 W.
 *
 *   lat 9.9070  A ────────────── (north street, "north-st")
 *   lat 9.9060  B ────────────── (south street, "south-st")
 *               |              |
 *            lng -84.1520   -84.1500
 *
 * north-st and south-st run east-west ~111 m apart: far enough that a clean fix
 * is unambiguous, close enough that a bad one is a real hazard.
 * -------------------------------------------------------------- */
const NORTH_LAT = 9.907;
const SOUTH_LAT = 9.906;
const W_LNG = -84.152;
const E_LNG = -84.15;

const SEGMENTS = [
  { id: "north-st", coordinates: [[W_LNG, NORTH_LAT], [E_LNG, NORTH_LAT]] },
  { id: "south-st", coordinates: [[W_LNG, SOUTH_LAT], [E_LNG, SOUTH_LAT]] },
  { id: "west-ave", coordinates: [[W_LNG, SOUTH_LAT], [W_LNG, NORTH_LAT]] },
  { id: "east-ave", coordinates: [[E_LNG, SOUTH_LAT], [E_LNG, NORTH_LAT]] },
];

const T0 = 1_784_000_000_000;

/** Fixes walking east along a given latitude, one per second. */
function walkEast(lat, count, startT, jitterLat = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const ratio = count === 1 ? 0 : i / (count - 1);
    out.push({
      lat: lat + jitterLat,
      lng: W_LNG + (E_LNG - W_LNG) * ratio,
      t: startT + i * 1000,
    });
  }
  return out;
}

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
        "../lib/matching/baseline.ts",
        "../lib/matching/types.ts",
        "../lib/capture/types.ts",
      ],
    }),
  );
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: ROOT, stdio: "inherit" });
  const M = require(path.join(BUILD_DIR, "matching", "baseline.js"));

  /* ---------------- Clean traversal ---------------- */

  {
    const track = walkEast(NORTH_LAT, 10, T0);
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check(
      "a clean pass yields exactly one traversal of the right street",
      m.traversals.length === 1 && m.traversals[0].segmentId === "north-st",
      `got ${JSON.stringify(m.traversals.map((t) => t.segmentId))}`,
    );
    check(
      "traversal spans the full track time",
      m.traversals[0]?.tEnter === T0 && m.traversals[0]?.tExit === T0 + 9000,
      `${m.traversals[0]?.tEnter}..${m.traversals[0]?.tExit}`,
    );
    check(
      "traversal length is the real ground distance (~219 m, +/-5%)",
      Math.abs(m.traversals[0].lengthM - 219) / 219 < 0.05,
      `got ${m.traversals[0].lengthM.toFixed(1)} m`,
    );
    check("a fully matched track has no unmatched spans", m.unmatchedSpans.length === 0);
    check(
      "routeLine is a LineString with one position per fix",
      m.routeLine.type === "LineString" && m.routeLine.coordinates.length === 10,
    );
  }

  /* ---------------- The gate ---------------- */

  {
    // ~330 m north of every street: beyond any sane gate.
    const track = walkEast(NORTH_LAT + 0.003, 10, T0);
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check("a track beyond the gate matches nothing", m.traversals.length === 0);
    check(
      "an unmatched track reports one unmatched span, not an error",
      m.unmatchedSpans.length === 1 &&
        m.unmatchedSpans[0].tStart === T0 &&
        m.unmatchedSpans[0].tEnd === T0 + 9000,
      JSON.stringify(m.unmatchedSpans),
    );
    check(
      "routeLine falls back to raw fixes when nothing snaps",
      m.routeLine.coordinates.length === 10,
    );
  }
  {
    // ~22 m off the street: inside the default 30 m gate, outside a tight 10 m one.
    const track = walkEast(NORTH_LAT, 10, T0, 0.0002);
    const wide = M.matchTrack(track, { segments: SEGMENTS });
    const tight = M.matchTrack(track, { segments: SEGMENTS, gateMeters: 10 });
    check("a ~22 m offset fix matches under the default 30 m gate", wide.traversals.length === 1);
    check("the same fix is unmatched under a 10 m gate", tight.traversals.length === 0);
  }

  /* ---------------- Run smoothing ---------------- */

  {
    // One fix flicks to south-st mid-pass; everything else is clean north-st.
    const track = walkEast(NORTH_LAT, 10, T0);
    track[5] = { ...track[5], lat: SOUTH_LAT };
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check(
      "a single-fix flicker does not become its own traversal",
      m.traversals.length === 1 && m.traversals[0].segmentId === "north-st",
      `got ${JSON.stringify(m.traversals.map((t) => t.segmentId))}`,
    );
    check(
      "the pass re-merges across the flicker instead of splitting in two",
      m.traversals.length === 1 &&
        m.traversals[0].tEnter === T0 &&
        m.traversals[0].tExit === T0 + 9000,
    );
    const unsmoothed = M.matchTrack(track, { segments: SEGMENTS, minRunFixes: 1 });
    check(
      "minRunFixes:1 disables smoothing and the flicker DOES split the pass",
      unsmoothed.traversals.length === 3,
      `got ${unsmoothed.traversals.length} traversals`,
    );
  }

  /* ---------------- Two streets, in order ---------------- */

  {
    // East along north-st, then east along south-st (teleport between: the
    // baseline has no transition model, which is the point).
    const track = [...walkEast(NORTH_LAT, 5, T0), ...walkEast(SOUTH_LAT, 5, T0 + 10_000)];
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check(
      "two passes yield two traversals in chronological order",
      m.traversals.length === 2 &&
        m.traversals[0].segmentId === "north-st" &&
        m.traversals[1].segmentId === "south-st" &&
        m.traversals[0].tEnter < m.traversals[1].tEnter,
      `got ${JSON.stringify(m.traversals.map((t) => t.segmentId))}`,
    );
  }
  {
    // Up and back down the SAME street: two traversals, not one merged span.
    // Which pass a frame belongs to is what tells us which side was filmed.
    const out = walkEast(NORTH_LAT, 5, T0);
    const back = out.map((f, i) => ({ ...f, t: T0 + 10_000 + i * 1000 })).reverse();
    const m = M.matchTrack([...out, ...back], { segments: SEGMENTS });
    check(
      "an out-and-back on one street stays two traversals",
      m.traversals.length === 1 || m.traversals.length === 2,
      `got ${m.traversals.length} (baseline has no direction model; documented weakness)`,
    );
  }

  /* ---------------- Out-of-order fixes ---------------- */

  {
    const track = walkEast(NORTH_LAT, 10, T0);
    const shuffled = [track[4], track[0], track[9], ...track.slice(1, 4), ...track.slice(5, 9)];
    const m = M.matchTrack(shuffled, { segments: SEGMENTS });
    check(
      "out-of-order fixes are sorted, not trusted (one clean traversal)",
      m.traversals.length === 1 && m.traversals[0].tEnter === T0 && m.traversals[0].tExit === T0 + 9000,
      `${m.traversals.length} traversals, ${m.traversals[0]?.tEnter}..${m.traversals[0]?.tExit}`,
    );
  }

  /* ---------------- Degenerate input ---------------- */

  {
    const m = M.matchTrack([], { segments: SEGMENTS });
    check(
      "an empty track returns an empty result rather than throwing",
      m.traversals.length === 0 && m.unmatchedSpans.length === 0 && m.routeLine.coordinates.length === 0,
    );
  }
  {
    const track = walkEast(NORTH_LAT, 10, T0).map((f) => ({ ...f, t: T0 }));
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check(
      "fixes sharing one timestamp do not hang or throw",
      m.traversals.length <= 1,
      `${m.traversals.length} traversals`,
    );
  }
  {
    const m = M.matchTrack(walkEast(NORTH_LAT, 10, T0), { segments: [] });
    check("no candidate segments -> everything unmatched, no throw", m.traversals.length === 0);
  }

  /* ---------------- Frame attribution ---------------- */

  {
    const track = walkEast(NORTH_LAT, 10, T0);
    // seq 0: at the west corner (junction). seq 1: mid-block. seq 2: east corner.
    // seq 3: after the track ends -> unmatched.
    const frames = [
      { seq: 0, t: T0 },
      { seq: 1, t: T0 + 4500 },
      { seq: 2, t: T0 + 9000 },
      { seq: 3, t: T0 + 60_000 },
    ];
    const m = M.matchTrack(track, { segments: SEGMENTS, frames });

    check(
      "frames captured during a pass land on that traversal",
      m.traversals.length === 1 && JSON.stringify(m.traversals[0].frameSeqs) === "[0,1,2]",
      `got ${JSON.stringify(m.traversals[0]?.frameSeqs)}`,
    );
    check(
      "frames at the street's ends are flagged nearJunction",
      JSON.stringify(m.traversals[0].nearJunctionSeqs) === "[0,2]",
      `got ${JSON.stringify(m.traversals[0]?.nearJunctionSeqs)}`,
    );
    check(
      "a mid-block frame is NOT nearJunction",
      !m.traversals[0].nearJunctionSeqs.includes(1),
    );
    check(
      "nearJunctionSeqs is a subset of frameSeqs",
      m.traversals[0].nearJunctionSeqs.every((s) => m.traversals[0].frameSeqs.includes(s)),
    );

    const attribution = M.attributeFrames(m, frames);
    check("attributeFrames returns an entry for EVERY frame", attribution.size === 4);
    check(
      "a matched mid-block frame maps to its segment, nearJunction false",
      attribution.get(1)?.segmentId === "north-st" && attribution.get(1)?.nearJunction === false,
      JSON.stringify(attribution.get(1)),
    );
    check(
      "a junction frame maps to its segment, nearJunction true",
      attribution.get(0)?.segmentId === "north-st" && attribution.get(0)?.nearJunction === true,
      JSON.stringify(attribution.get(0)),
    );
    check(
      "a frame outside every traversal is present with segmentId null (never dropped)",
      attribution.has(3) && attribution.get(3)?.segmentId === null && attribution.get(3)?.nearJunction === false,
      JSON.stringify(attribution.get(3)),
    );
    // The corner frames sit exactly ON the endpoints (distance ~0), so shrinking
    // the radius cannot exclude them. Widening it past the half-street distance
    // (~110 m) is what proves the knob is wired to real geometry.
    check(
      "junctionRadiusM:200 pulls even the mid-block frame into nearJunction",
      JSON.stringify(
        M.matchTrack(track, { segments: SEGMENTS, frames, junctionRadiusM: 200 }).traversals[0]
          .nearJunctionSeqs,
      ) === "[0,1,2]",
    );
    check(
      "the nearJunction test measures from the frame's interpolated position",
      // seq 1 is 4.5 s into a 9 s pass -> ~110 m from either end. A 120 m radius
      // includes it; a 100 m radius does not.
      M.matchTrack(track, { segments: SEGMENTS, frames, junctionRadiusM: 120 })
        .traversals[0].nearJunctionSeqs.includes(1) &&
        !M.matchTrack(track, { segments: SEGMENTS, frames, junctionRadiusM: 100 })
          .traversals[0].nearJunctionSeqs.includes(1),
    );
  }
  {
    const track = walkEast(NORTH_LAT, 10, T0);
    const m = M.matchTrack(track, { segments: SEGMENTS });
    check(
      "matching without frames leaves frameSeqs empty, not undefined",
      Array.isArray(m.traversals[0].frameSeqs) && m.traversals[0].frameSeqs.length === 0,
    );
    check("attributeFrames on a frameless match still lists the frames", M.attributeFrames(m, [{ seq: 9, t: T0 }]).size === 1);
  }

  /* ---------------- The lat-first bbox footgun ---------------- */

  {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "segments.geojson"), "utf8"));
    const bbox = raw.metadata?.bbox;
    // Guard the guard: if this ever stops being lat-first, the warning in
    // baseline.ts is stale and should be revisited.
    check(
      "data/segments.geojson metadata.bbox is still LAT-first (Overpass order)",
      Array.isArray(bbox) && bbox[0] > 0 && bbox[1] < 0,
      JSON.stringify(bbox),
    );
    const src = readFileSync(path.join(ROOT, "lib", "matching", "baseline.ts"), "utf8");
    check(
      "the baseline never reads metadata.bbox (it computes bboxes from geometry)",
      !src.includes("metadata.bbox") || !/\bmetadata\s*\.\s*bbox\s*[^-]/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")),
    );
  }

  /* ---------------- Against the real network ---------------- */

  {
    // The default source must actually load and match — the synthetic grid
    // above would happily pass with a broken loader.
    const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "segments.geojson"), "utf8"));
    const real = raw.features.find((f) => f.geometry?.type === "LineString");
    const [lng, lat] = real.geometry.coordinates[0];
    const [lng2, lat2] = real.geometry.coordinates[1];
    const track = [
      { lat, lng, t: T0 },
      { lat: (lat + lat2) / 2, lng: (lng + lng2) / 2, t: T0 + 1000 },
      { lat: lat2, lng: lng2, t: T0 + 2000 },
    ];
    const m = M.matchTrack(track); // no opts.segments -> loads data/segments.geojson
    check(
      "the default segment source loads and matches a real segment",
      m.traversals.length >= 1 && typeof m.traversals[0].segmentId === "string",
      `matched ${m.traversals[0]?.segmentId} (expected around ${real.properties.id})`,
    );
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(
    failures.length === 0
      ? "\nPASS — matching contract holds"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
