#!/usr/bin/env node
/**
 * test-matching-canton.mjs (bgsd-0003 canton network expansion)
 *
 * The pilot's HMM matching is guarded by test-matching-hmm.mjs. This test proves
 * the SAME matcher works over the expanded canton network: a synthetic GPS walk
 * laid on a real Escazú centro street matches to that esc-ce segment, using the
 * production lib/matching HMM with ALL 1457 canton segments as candidates.
 *
 * The centrepiece fixture is a real, measured centro street:
 *   esc-ce-0040 "Calle 35" — 173 m, sinuosity 1.001 (dead straight), nearest
 *   non-adjacent segment 202 m away. If canton matching regresses (e.g. a new
 *   district segment starts stealing centro walks, or the network stops loading),
 *   this fails.
 *
 * Noise is a seeded PRNG, so the matcher and its test are both deterministic.
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
const BUILD_DIR = path.join(ROOT, ".test-build-canton");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------- *
 * Fixture — a real, measured Escazú centro street.
 * -------------------------------------------------------------- */
const CENTRO_STREET = "esc-ce-0040"; // Calle 35, 173 m, dead straight

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

function cumulativeOf(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return cum;
}

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

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

function offsetMeters(pos, eastM, northM) {
  const dLat = northM / 110_540;
  const dLng = eastM / (111_320 * Math.cos(toRad(pos[1])));
  return [pos[0] + dLng, pos[1] + dLat];
}

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

const ids = (m) => m.traversals.map((t) => t.segmentId);

function main() {
  check(
    `fixture ${CENTRO_STREET} is present in the canton network`,
    byId.has(CENTRO_STREET),
    byId.has(CENTRO_STREET) ? "" : "missing from data/segments.geojson",
  );
  if (!byId.has(CENTRO_STREET)) {
    console.log(`\nFAIL — fixture missing`);
    process.exit(1);
  }
  console.log(
    `[canton] network carries ${SEGMENTS.length} segments; ` +
      `${SEGMENTS.filter((s) => s.id.startsWith("esc-ce-")).length} in Escazú centro`,
  );

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
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

  /* ============ 1. Straight walk down a centro street, 8 m noise ============ */
  console.log(`\n1. noisy straight walk down ${CENTRO_STREET} (Calle 35), 8 m Gaussian noise`);
  {
    const L = lengthOf(CENTRO_STREET);
    const track = walkSegment(CENTRO_STREET, 20, L - 20, T0, 8, 4040);
    const m = H.matchTrack(track, { segments: SEGMENTS });

    check(
      "the walk yields exactly one traversal",
      m.traversals.length === 1,
      `got ${JSON.stringify(ids(m))}`,
    );
    check(
      "...matched to the centro street actually walked",
      m.traversals[0]?.segmentId === CENTRO_STREET,
      `got ${m.traversals[0]?.segmentId}`,
    );
    check(
      "every matched segment is in Escazú centro (no cross-district flip)",
      ids(m).length > 0 && ids(m).every((id) => id.startsWith("esc-ce-")),
      `got ${JSON.stringify(ids(m))}`,
    );
    const walked = L - 40;
    check(
      "traversal length is close to the distance walked (+/-15%)",
      m.traversals.length === 1 && Math.abs(m.traversals[0].lengthM - walked) / walked < 0.15,
      `got ${m.traversals[0]?.lengthM?.toFixed(1)} m of ~${walked.toFixed(0)} m`,
    );
    check("a fully matched centro walk reports no unmatched spans", m.unmatchedSpans.length === 0);
    check(
      "routeLine is a LineString on the canton network",
      m.routeLine.type === "LineString" && m.routeLine.coordinates.length >= 2,
    );
  }

  /* ============ 2. Determinism over the canton network ============ */
  console.log("\n2. matching stays deterministic over the larger canton network");
  {
    const L = lengthOf(CENTRO_STREET);
    const track = walkSegment(CENTRO_STREET, 20, L - 20, T0, 8, 4040);
    const a = JSON.stringify(H.matchTrack(track, { segments: SEGMENTS }));
    const b = JSON.stringify(H.matchTrack(track, { segments: SEGMENTS }));
    check("same input, same output twice", a === b);
  }

  console.log(
    `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failing check(s)` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  rmSync(BUILD_DIR, { recursive: true, force: true });
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
