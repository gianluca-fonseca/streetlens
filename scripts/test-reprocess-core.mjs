#!/usr/bin/env node
/**
 * test-reprocess-core.mjs — the pure logic behind reprocess-capture-session.mjs.
 *
 * No network, no database, no matcher: this covers the reconstruction and
 * summary logic the script owns, against a fixture track. The matcher itself is
 * covered by scripts/test-matching-hmm.mjs.
 *
 * The centrepiece is buildTrackFromSession: the stored track loses its per-vertex
 * times at finalize, so the script rebuilds them from the frames' capture times.
 * These checks pin that reconstruction (monotonic, brackets the frame span,
 * arc-length proportional) and the edge cases the script leans on as no-ops.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import {
  haversine,
  buildTrackFromSession,
  buildAttributionPayload,
  summarizeAttribution,
  loadSegments,
} from "./reprocess-core.mjs";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------- *
 * Fixtures — a straight west-to-east track, evenly spaced.
 * -------------------------------------------------------------- */

const T0 = 1_784_000_000_000;
// Five vertices marching east at ~9.9 lat; roughly evenly spaced.
const TRACK = [
  { lng: -84.150, lat: 9.907 },
  { lng: -84.149, lat: 9.907 },
  { lng: -84.148, lat: 9.907 },
  { lng: -84.147, lat: 9.907 },
  { lng: -84.146, lat: 9.907 },
];
// Eleven frames across a 20 s window (like the motivating session's cadence).
const FRAMES = Array.from({ length: 11 }, (_, i) => ({ seq: i, t: T0 + i * 2000 }));

/* ============ 1. haversine sanity ============ */
console.log("\n1. haversine");
{
  // One degree of longitude at the equator-ish latitude is ~109 km; at 9.9 lat,
  // cos(9.9deg) ~= 0.985, so ~109.6 km. Just check the order of magnitude.
  const d = haversine({ lng: -84.150, lat: 9.907 }, { lng: -84.140, lat: 9.907 });
  check("~1.1 km for 0.01 deg of longitude", d > 1000 && d < 1200, `${d.toFixed(0)} m`);
  check("zero distance for the same point", haversine([0, 0], [0, 0]) === 0);
}

/* ============ 2. buildTrackFromSession — the reconstruction ============ */
console.log("\n2. buildTrackFromSession");
{
  const rebuilt = buildTrackFromSession(TRACK, FRAMES);
  check("one point per track vertex", rebuilt.length === TRACK.length, `${rebuilt.length}`);
  check("lng/lat are preserved verbatim", rebuilt.every((p, i) => p.lng === TRACK[i].lng && p.lat === TRACK[i].lat));
  check("every point carries a finite time", rebuilt.every((p) => Number.isFinite(p.t)));
  check("times are non-decreasing (monotonic along the track)", rebuilt.every((p, i) => i === 0 || p.t >= rebuilt[i - 1].t));

  const tMin = Math.min(...FRAMES.map((f) => f.t));
  const tMax = Math.max(...FRAMES.map((f) => f.t));
  check("first vertex sits at the frame span start", rebuilt[0].t === tMin, `${rebuilt[0].t} vs ${tMin}`);
  check("last vertex sits at the frame span end", rebuilt[rebuilt.length - 1].t === tMax, `${rebuilt[rebuilt.length - 1].t} vs ${tMax}`);

  // Evenly spaced vertices => the middle vertex should land near the span midpoint.
  const mid = rebuilt[2].t;
  const expectMid = tMin + (tMax - tMin) / 2;
  check("an evenly-spaced middle vertex lands near the span midpoint", Math.abs(mid - expectMid) < (tMax - tMin) * 0.1, `${mid} vs ~${expectMid}`);
}

/* ============ 3. buildTrackFromSession — no-op edges ============ */
console.log("\n3. buildTrackFromSession edges");
{
  check("no track => empty (script treats as no-op)", buildTrackFromSession([], FRAMES).length === 0);
  check("no frames => empty (no time anchor)", buildTrackFromSession(TRACK, []).length === 0);
  check("null inputs do not throw", buildTrackFromSession(null, null).length === 0);

  // Single frame: no span, so every vertex shares the one time we have.
  const one = buildTrackFromSession(TRACK, [{ seq: 0, t: T0 }]);
  check("a single frame gives every vertex the same time", one.length === TRACK.length && one.every((p) => p.t === T0));

  // Zero-length track (all vertices identical): no arc length to spread time by.
  const flat = buildTrackFromSession([{ lng: 1, lat: 1 }, { lng: 1, lat: 1 }], FRAMES);
  check("a zero-length track collapses time to the span start", flat.every((p) => p.t === T0));
}

/* ============ 4. summarizeAttribution ============ */
console.log("\n4. summarizeAttribution");
{
  const attribution = new Map([
    [0, { segmentId: "esc-sa-0001", nearJunction: false }],
    [1, { segmentId: "esc-sa-0001", nearJunction: true }],
    [2, { segmentId: "esc-sa-0002", nearJunction: false }],
    [3, { segmentId: null, nearJunction: false }],
    // seq 4 deliberately absent from the map (matcher returned nothing for it).
  ]);
  const frames = [0, 1, 2, 3, 4].map((seq) => ({ seq }));
  const s = summarizeAttribution(frames, attribution);
  check("total counts every frame", s.total === 5, `${s.total}`);
  check("attributed counts only placed frames", s.attributed === 3, `${s.attributed}`);
  check("unmatched counts null AND absent frames", s.unmatched === 2, `${s.unmatched}`);
  check("per-segment tallies are right", s.bySegment["esc-sa-0001"] === 2 && s.bySegment["esc-sa-0002"] === 1, JSON.stringify(s.bySegment));
  check("a null-segment frame never appears in bySegment", !("null" in s.bySegment) && Object.keys(s.bySegment).length === 2);
}

/* ============ 5. buildAttributionPayload ============ */
console.log("\n5. buildAttributionPayload");
{
  const attribution = new Map([
    [0, { segmentId: "esc-sa-0001", nearJunction: true }],
    [2, { segmentId: null, nearJunction: false }],
  ]);
  const frames = [0, 1, 2].map((seq) => ({ seq }));
  const payload = buildAttributionPayload(frames, attribution);
  check("one entry per frame, in order", payload.length === 3 && payload.map((p) => p.seq).join(",") === "0,1,2");
  check("a matched frame carries its segment and junction flag", payload[0].segmentId === "esc-sa-0001" && payload[0].nearJunction === true);
  check("an absent frame is null / not-near-junction, not dropped", payload[1].segmentId === null && payload[1].nearJunction === false);
  check("a null-segment frame is kept as null", payload[2].segmentId === null);
}

/* ============ 6. loadSegments ============ */
console.log("\n6. loadSegments");
{
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "esc-sa-0001" }, geometry: { type: "LineString", coordinates: [[-84.15, 9.9], [-84.14, 9.9]] } },
      // A point feature and an id-less line: both must be filtered out.
      { type: "Feature", properties: { id: "ignore-me" }, geometry: { type: "Point", coordinates: [-84.15, 9.9] } },
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
    ],
  });
  const segs = loadSegments(() => geojson, "ignored-path");
  check("only LineStrings with a string id survive", segs.length === 1 && segs[0].id === "esc-sa-0001", JSON.stringify(segs.map((s) => s.id)));
  check("coordinates are carried through", Array.isArray(segs[0].coordinates) && segs[0].coordinates.length === 2);
}

console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failing check(s)` +
    (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
);
process.exit(failures.length === 0 ? 0 : 1);
