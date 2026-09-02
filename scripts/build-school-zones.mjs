// scripts/build-school-zones.mjs
//
// Precomputes each school's ZONE: which street segments lie within walking
// distance of the gate, how far each one is, and which ring it falls in.
//
// ── WHY THIS IS A BUILD STEP AND THE SCORE IS NOT ──────────────────────────
// Zone membership depends only on GEOMETRY — where the school is and how the
// streets connect. Geometry changes when the roster changes or the network is
// re-imported, which is a build. Scores depend on the CURRENT reading of each
// segment, which changes every time a capture is reviewed, so those are
// computed at read time from live data (lib/school-score.ts).
//
// Splitting it this way is what makes the admin's "refresh" honest: pressing it
// re-reads the segments and rescores, and the answer moves the moment new field
// data lands, with no rebuild and no stale snapshot pretending to be current.
//
// ── HOW THE WALKSHED IS COMPUTED ───────────────────────────────────────────
// Dijkstra over data/routing-network.geojson, which is 99.2% one connected
// component (12,768 nodes) and was built for exactly this — it keeps footways
// and shared OSM node coordinates, so two ways that meet at an intersection
// share a vertex and the router can turn there.
//
// Mapping the result back onto the SCORED segments is exact rather than
// approximate: every one of the 1,457 segments in data/segments.geojson shares
// at least one vertex, to six decimal places, with the routing graph — both were
// carved from the same Overpass ways. So a segment's walking distance is the
// smallest settled distance among its own vertices. No snapping tolerance, no
// nearest-neighbour guess, nothing to tune.
//
// A segment counts as reachable at the distance of its NEAREST vertex: the
// question is "can a child reach any part of this street within R", not "is the
// whole street inside R". A 200 m block whose near end is 380 m away is walked
// on, and pretending otherwise would drop real frontage out of the zone.
//
// Run: `node scripts/build-school-zones.mjs`
// Pure Node ESM, Node 20+, zero dependencies, no network.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHOOLS_PATH = join(ROOT, "data", "schools.geojson");
const NETWORK_PATH = join(ROOT, "data", "routing-network.geojson");
const SEGMENTS_PATH = join(ROOT, "data", "segments.geojson");
const OUT_PATH = join(ROOT, "data", "school-zones.json");

// MIRRORS lib/school-score.ts SCHOOL_ZONE. This script cannot import the .ts
// module without a build step, so the two radii are replicated here and the
// test suite asserts they still agree. Change one, change both.
const GATE_RADIUS_M = 150;
const WALK_RADIUS_M = 400;

/** Ways a child on foot cannot use. Motorway frontage is not a walk to school. */
const NON_WALKABLE = new Set(["motorway", "motorway_link", "trunk_link", "construction", "raceway"]);

const R_EARTH = 6371000;

function haversine(a, b) {
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Six decimals ≈ 0.11 m — the precision the routing graph was emitted at. */
const key = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;

/* ------------------------------------------------------- binary min-heap */

/** Small explicit heap. Sorting an array each pop is O(n log n) per step and
 *  turns 33 walksheds into a noticeable wait; this keeps the whole build under
 *  a second. */
class MinHeap {
  #a = [];
  get size() {
    return this.#a.length;
  }
  push(item) {
    const a = this.#a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.#a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l].d < a[s].d) s = l;
        if (r < a.length && a[r].d < a[s].d) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------------ main */

const schools = JSON.parse(readFileSync(SCHOOLS_PATH, "utf8"));
const network = JSON.parse(readFileSync(NETWORK_PATH, "utf8"));
const segments = JSON.parse(readFileSync(SEGMENTS_PATH, "utf8"));

console.log("→ building the walkable graph");
/** node key → [{ to, d }] */
const adj = new Map();
const coordOf = new Map();
let skipped = 0;

function link(a, b, ca, cb) {
  const d = haversine(ca, cb);
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push({ to: b, d });
  adj.get(b).push({ to: a, d });
  coordOf.set(a, ca);
  coordOf.set(b, cb);
}

for (const f of network.features) {
  if (NON_WALKABLE.has(f.properties?.highway)) {
    skipped += 1;
    continue;
  }
  const cs = f.geometry.coordinates;
  for (let i = 1; i < cs.length; i++) {
    link(key(cs[i - 1]), key(cs[i]), cs[i - 1], cs[i]);
  }
}
console.log("  %d nodes, %d ways skipped as non-walkable", adj.size, skipped);

// Segment vertices, indexed by graph node, so a settled node immediately tells
// us which scored segments it belongs to.
const segmentsAtNode = new Map();
const segmentMeta = new Map();
for (const f of segments.features) {
  const p = f.properties;
  segmentMeta.set(p.id, { length_m: p.length_m ?? 0, name: p.name ?? p.id, district: p.district_id ?? null });
  for (const c of f.geometry.coordinates) {
    const k = key(c);
    if (!adj.has(k)) continue;
    if (!segmentsAtNode.has(k)) segmentsAtNode.set(k, new Set());
    segmentsAtNode.get(k).add(p.id);
  }
}
const reachableSegments = new Set([...segmentsAtNode.values()].flatMap((s) => [...s]));
console.log(
  "  %d of %d scored segments touch the walkable graph",
  reachableSegments.size,
  segments.features.length,
);

/** Nearest graph node to an arbitrary point. Linear, but 33 × 12k is nothing. */
function nearestNode(lonlat) {
  let best = null;
  let bestD = Infinity;
  for (const [k, c] of coordOf) {
    const d = haversine(lonlat, c);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return { node: best, snap_m: bestD };
}

console.log("→ walking %d school zones", schools.features.length);
const zones = [];
let unreachable = 0;

for (const school of schools.features) {
  const origin = school.geometry.coordinates;
  const { node: start, snap_m } = nearestNode(origin);

  // Dijkstra, bounded at the outer ring. The bound is what keeps this cheap:
  // the search never leaves the neighbourhood.
  const dist = new Map([[start, snap_m]]);
  const heap = new MinHeap();
  heap.push({ node: start, d: snap_m });
  const settled = new Set();

  while (heap.size) {
    const { node, d } = heap.pop();
    if (settled.has(node)) continue;
    settled.add(node);
    if (d > WALK_RADIUS_M) continue;
    for (const edge of adj.get(node) ?? []) {
      const nd = d + edge.d;
      if (nd > WALK_RADIUS_M) continue;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        heap.push({ node: edge.to, d: nd });
      }
    }
  }

  // Nearest settled distance per scored segment.
  const best = new Map();
  for (const [node, d] of dist) {
    if (d > WALK_RADIUS_M) continue;
    for (const id of segmentsAtNode.get(node) ?? []) {
      if (d < (best.get(id) ?? Infinity)) best.set(id, d);
    }
  }

  const members = [...best.entries()]
    .map(([segment_id, raw]) => {
      // Round BEFORE choosing the ring. Deciding on the raw distance and then
      // rounding for storage lets a segment at 150.04 m be filed as `walk` while
      // the row reads 150.0, so the published data contradicts its own rule at
      // the boundary. The rounded metre is what anyone will check against.
      const walk_m = Number(raw.toFixed(1));
      return {
        segment_id,
        ring: walk_m <= GATE_RADIUS_M ? "gate" : "walk",
        walk_m,
        length_m: segmentMeta.get(segment_id)?.length_m ?? 0,
      };
    })
    .sort((a, b) => a.walk_m - b.walk_m);

  if (members.length === 0) unreachable += 1;

  zones.push({
    school_id: school.properties.id,
    name: school.properties.display_name,
    /** How far the gate is from the nearest routable way. A large snap means
     *  the campus sits off the mapped network and the zone starts further out
     *  than it should — worth a field check before quoting the score. */
    snap_m: Number(snap_m.toFixed(1)),
    length_m: {
      total: Number(members.reduce((m, x) => m + x.length_m, 0).toFixed(1)),
      gate: Number(
        members.filter((m) => m.ring === "gate").reduce((m, x) => m + x.length_m, 0).toFixed(1),
      ),
    },
    counts: {
      members: members.length,
      gate: members.filter((m) => m.ring === "gate").length,
    },
    members,
  });
}

const totals = {
  schools: zones.length,
  members: zones.reduce((m, z) => m + z.members.length, 0),
  unreachable,
  mean_members: Number((zones.reduce((m, z) => m + z.members.length, 0) / zones.length).toFixed(1)),
  max_snap_m: Number(Math.max(...zones.map((z) => z.snap_m)).toFixed(1)),
};

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generated_by: "scripts/build-school-zones.mjs",
      gate_radius_m: GATE_RADIUS_M,
      walk_radius_m: WALK_RADIUS_M,
      non_walkable: [...NON_WALKABLE],
      note: "Zone MEMBERSHIP only — geometry, no scores. Scores are computed at read time from live segment data so a refresh reflects new field work immediately. See lib/school-score.ts.",
      totals,
      zones,
    },
    null,
    2,
  ) + "\n",
);

console.log("");
for (const z of [...zones].sort((a, b) => b.members.length - a.members.length).slice(0, 6)) {
  console.log(
    "  %s %s members (%s gate) · %s m",
    z.name.slice(0, 42).padEnd(44),
    String(z.counts.members).padStart(3),
    String(z.counts.gate).padStart(2),
    String(Math.round(z.length_m.total)).padStart(5),
  );
}
console.log("");
console.log(
  "%d zones · %d memberships · mean %s segments · worst gate snap %s m",
  totals.schools,
  totals.members,
  totals.mean_members,
  totals.max_snap_m,
);
if (unreachable) console.log("WARNING: %d schools reached no scored segment", unreachable);
console.log("wrote %s", OUT_PATH);
