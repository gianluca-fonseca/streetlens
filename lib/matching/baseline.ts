// BASELINE — replaced by HMM in unit-hmm-map-matching.
//
// This is the simplest thing that produces correct-shaped output: snap each fix
// independently to the nearest segment within a gate, then smooth the resulting
// label sequence by collapsing consecutive runs. It has NO notion of network
// topology and NO transition model, so it is knowingly weak exactly where map
// matching is hard:
//
//   - Parallel streets ~20 m apart: a noisy fix can snap to the wrong one, and
//     only the run-length filter (not connectivity) argues it back.
//   - Junctions: the fix nearest the corner may snap to either arm.
//   - Teleports: nothing forbids fix N on one street and fix N+1 across town.
//
// The HMM unit fixes all three with emission + transition probabilities over a
// routable graph. It must keep `lib/matching/types.ts` satisfied; everything
// downstream imports from `lib/matching`, never from this file.
//
// Server-side only: the default segment source reads from disk.

import nearestPointOnLine from "@turf/nearest-point-on-line";
import distance from "@turf/distance";
import { lineString, point } from "@turf/helpers";
import type { LineString, Position } from "geojson";
import type { TrackPoint } from "@/lib/capture/types";
import type {
  AttributeFrames,
  FrameAttributionResult,
  FrameTime,
  MatchOptions,
  MatchResult,
  MatchSegment,
  MatchTrack,
  SegmentTraversal,
  UnmatchedSpan,
} from "./types";

const DEFAULT_GATE_METERS = 30;
const DEFAULT_MIN_RUN_FIXES = 2;
const DEFAULT_JUNCTION_RADIUS_M = 20;

/** Metres per degree of latitude. Good to ~0.5% anywhere; we only pad bboxes with it. */
const M_PER_DEG_LAT = 111_320;

/* ------------------------------------------------------------------ *
 * Segment index
 * ------------------------------------------------------------------ */

type IndexedSegment = {
  id: string;
  coordinates: [number, number][];
  /** [minLng, minLat, maxLng, maxLat] — computed from geometry, never read from a file. */
  bbox: [number, number, number, number];
  /** The two ends of the street: our junction proxy. */
  endpoints: [Position, Position];
};

/**
 * Build the candidate index.
 *
 * FOOTGUN, deliberately avoided: `data/segments.geojson` carries a
 * `metadata.bbox` in Overpass's LAT-FIRST order ([minLat, minLng, maxLat,
 * maxLng]), which is NOT the GeoJSON convention. Reading it would silently
 * transpose every gate check into the ocean. Bboxes here are always computed
 * from the geometry.
 */
function indexSegments(segments: MatchSegment[]): IndexedSegment[] {
  const indexed: IndexedSegment[] = [];
  for (const seg of segments) {
    if (seg.coordinates.length < 2) continue;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of seg.coordinates) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    indexed.push({
      id: seg.id,
      coordinates: seg.coordinates,
      bbox: [minLng, minLat, maxLng, maxLat],
      endpoints: [
        seg.coordinates[0],
        seg.coordinates[seg.coordinates.length - 1],
      ],
    });
  }
  return indexed;
}

/** Degree padding for a metre gate at this latitude, for the bbox prefilter. */
function gatePadding(gateMeters: number, lat: number): { dLng: number; dLat: number } {
  const dLat = gateMeters / M_PER_DEG_LAT;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
  return { dLat, dLng: gateMeters / (M_PER_DEG_LAT * cos) };
}

/* ------------------------------------------------------------------ *
 * Snapping
 * ------------------------------------------------------------------ */

type Snap = {
  segmentId: string;
  /** Snapped position on the segment, [lng, lat]. */
  position: Position;
  /** Distance from the raw fix to the segment, metres. */
  distM: number;
};

/**
 * Nearest segment within the gate, or null.
 *
 * The bbox prefilter is what makes an O(fixes x segments) baseline tolerable:
 * a 30 m gate around one fix touches a handful of the 535 segments, so the
 * expensive turf snap runs a handful of times per fix rather than 535.
 */
function snapFix(
  fix: TrackPoint,
  segments: IndexedSegment[],
  gateMeters: number,
): Snap | null {
  const pt = point([fix.lng, fix.lat]);
  const { dLng, dLat } = gatePadding(gateMeters, fix.lat);

  let best: Snap | null = null;
  for (const seg of segments) {
    const [minLng, minLat, maxLng, maxLat] = seg.bbox;
    if (
      fix.lng < minLng - dLng ||
      fix.lng > maxLng + dLng ||
      fix.lat < minLat - dLat ||
      fix.lat > maxLat + dLat
    ) {
      continue;
    }
    const snapped = nearestPointOnLine(lineString(seg.coordinates), pt, {
      units: "meters",
    });
    const distM = snapped.properties.dist ?? Infinity;
    if (distM <= gateMeters && (best === null || distM < best.distM)) {
      best = {
        segmentId: seg.id,
        position: snapped.geometry.coordinates,
        distM,
      };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

type Run = {
  segmentId: string | null;
  /** Indices into the (time-sorted) track. */
  from: number;
  to: number;
};

/** Collapse a per-fix label sequence into consecutive runs. */
function toRuns(labels: (string | null)[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < labels.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.segmentId === labels[i]) {
      last.to = i;
    } else {
      runs.push({ segmentId: labels[i], from: i, to: i });
    }
  }
  return runs;
}

/**
 * Suppress matched runs shorter than `minRunFixes` — the flicker where a noisy
 * fix snaps to a parallel street for one sample.
 *
 * A short run is ABSORBED into its neighbours when both sides agree on the same
 * segment, and only otherwise blanked to unmatched. Absorbing matters: merely
 * blanking it would leave a hole, and the single pass would still emerge as two
 * traversals separated by a one-fix unmatched span, which is the exact artifact
 * this is meant to remove.
 *
 * Unmatched runs are never absorbed. A real gate dropout is a hole in what we
 * observed, and papering over it would claim coverage we do not have.
 */
function smoothRuns(labels: (string | null)[], minRunFixes: number): Run[] {
  const cleaned = [...labels];
  const runs = toRuns(labels);

  runs.forEach((run, i) => {
    if (run.segmentId === null) return;
    if (run.to - run.from + 1 >= minRunFixes) return;

    const prev = runs[i - 1]?.segmentId ?? null;
    const next = runs[i + 1]?.segmentId ?? null;
    // Bridge only when the flicker is genuinely surrounded by one street.
    const absorbInto = prev !== null && prev === next ? prev : null;
    for (let j = run.from; j <= run.to; j++) cleaned[j] = absorbInto;
  });

  return toRuns(cleaned);
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

function metresBetween(a: Position, b: Position): number {
  return distance(point(a), point(b), { units: "meters" });
}

/** Interpolate a position at time `t` by walking the track. Clamps outside the track. */
function positionAt(track: TrackPoint[], positions: Position[], t: number): Position | null {
  if (track.length === 0) return null;
  if (t <= track[0].t) return positions[0];
  if (t >= track[track.length - 1].t) return positions[positions.length - 1];

  for (let i = 1; i < track.length; i++) {
    if (track[i].t < t) continue;
    const prev = track[i - 1];
    const next = track[i];
    const span = next.t - prev.t;
    // Two fixes sharing a timestamp: no basis to interpolate, take the earlier.
    if (span <= 0) return positions[i - 1];
    const ratio = (t - prev.t) / span;
    const [aLng, aLat] = positions[i - 1];
    const [bLng, bLat] = positions[i];
    return [aLng + (bLng - aLng) * ratio, aLat + (bLat - aLat) * ratio];
  }
  return positions[positions.length - 1];
}

/* ------------------------------------------------------------------ *
 * Default segment source
 * ------------------------------------------------------------------ */

let cachedDefaultSegments: MatchSegment[] | null = null;

/**
 * Load `data/segments.geojson` — the audited street network.
 *
 * Lazy + cached: importing this module must not read the disk, so the browser
 * bundle and the type-only consumers stay clean. Uses a runtime require so the
 * node:fs dependency never reaches a client bundle.
 */
function loadDefaultSegments(): MatchSegment[] {
  if (cachedDefaultSegments) return cachedDefaultSegments;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");

  const file = nodePath.join(process.cwd(), "data", "segments.geojson");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    features?: {
      properties?: { id?: unknown };
      geometry?: { type?: string; coordinates?: unknown };
    }[];
  };

  const segments: MatchSegment[] = [];
  for (const feature of parsed.features ?? []) {
    const id = feature.properties?.id;
    if (typeof id !== "string") continue;
    if (feature.geometry?.type !== "LineString") continue;
    segments.push({
      id,
      coordinates: feature.geometry.coordinates as [number, number][],
    });
  }
  cachedDefaultSegments = segments;
  return segments;
}

/* ------------------------------------------------------------------ *
 * matchTrack
 * ------------------------------------------------------------------ */

/**
 * BASELINE matcher — see the file header for what it knowingly gets wrong.
 *
 * Fixes are sorted by time first: a track assembled from a paused-and-resumed
 * recording can arrive out of order, and every downstream span assumes
 * monotonic time.
 */
export const matchTrack: MatchTrack = (track, opts = {}): MatchResult => {
  const gateMeters = opts.gateMeters ?? DEFAULT_GATE_METERS;
  const minRunFixes = opts.minRunFixes ?? DEFAULT_MIN_RUN_FIXES;
  const junctionRadiusM = opts.junctionRadiusM ?? DEFAULT_JUNCTION_RADIUS_M;
  const segments = indexSegments(opts.segments ?? loadDefaultSegments());

  const sorted = [...track].sort((a, b) => a.t - b.t);

  if (sorted.length === 0) {
    return { traversals: [], unmatchedSpans: [], routeLine: emptyLine() };
  }

  const snaps = sorted.map((fix) => snapFix(fix, segments, gateMeters));
  const labels = snaps.map((s) => (s ? s.segmentId : null));

  // The travelled route: the snapped position where we have one, the raw fix
  // where we do not. The HMM matcher returns the true on-network route instead.
  const routePositions: Position[] = sorted.map((fix, i) =>
    snaps[i] ? snaps[i]!.position : [fix.lng, fix.lat],
  );

  const runs = smoothRuns(labels, minRunFixes);
  const byId = new Map(segments.map((s) => [s.id, s]));

  const traversals: SegmentTraversal[] = [];
  const unmatchedSpans: UnmatchedSpan[] = [];

  for (const run of runs) {
    const tEnter = sorted[run.from].t;
    const tExit = sorted[run.to].t;

    if (run.segmentId === null) {
      unmatchedSpans.push({ tStart: tEnter, tEnd: tExit });
      continue;
    }

    let lengthM = 0;
    for (let i = run.from + 1; i <= run.to; i++) {
      lengthM += metresBetween(routePositions[i - 1], routePositions[i]);
    }

    traversals.push({
      segmentId: run.segmentId,
      tEnter,
      tExit,
      lengthM,
      frameSeqs: [],
      nearJunctionSeqs: [],
    });
  }

  // Frames are attributed here (rather than in a second pass) because only the
  // matcher has the geometry needed to decide `nearJunction`.
  if (opts.frames?.length) {
    for (const frame of [...opts.frames].sort((a, b) => a.t - b.t)) {
      const traversal = traversals.find(
        (tr) => frame.t >= tr.tEnter && frame.t <= tr.tExit,
      );
      if (!traversal) continue;
      traversal.frameSeqs.push(frame.seq);

      const seg = byId.get(traversal.segmentId);
      const pos = positionAt(sorted, routePositions, frame.t);
      if (!seg || !pos) continue;
      const nearJunction = seg.endpoints.some(
        (end) => metresBetween(pos, end) <= junctionRadiusM,
      );
      if (nearJunction) traversal.nearJunctionSeqs.push(frame.seq);
    }
  }

  return {
    traversals,
    unmatchedSpans,
    routeLine: lineString(
      routePositions.length >= 2
        ? routePositions
        : [routePositions[0], routePositions[0]],
    ).geometry,
  };
};

function emptyLine(): LineString {
  return { type: "LineString", coordinates: [] };
}

/* ------------------------------------------------------------------ *
 * attributeFrames
 * ------------------------------------------------------------------ */

/**
 * Invert a match into a per-frame lookup. Pure bookkeeping over what
 * `matchTrack` already decided — the geometry work happened there.
 *
 * Every frame appears in the result. One shot during an unmatched span maps to
 * `{ segmentId: null, nearJunction: false }` rather than vanishing: a dropped
 * frame would quietly inflate coverage.
 */
export const attributeFrames: AttributeFrames = (
  match: MatchResult,
  frames: FrameTime[],
): Map<number, FrameAttributionResult> => {
  const bySeq = new Map<number, FrameAttributionResult>();
  for (const frame of frames) {
    bySeq.set(frame.seq, { segmentId: null, nearJunction: false });
  }
  for (const traversal of match.traversals) {
    const junctions = new Set(traversal.nearJunctionSeqs);
    for (const seq of traversal.frameSeqs) {
      if (!bySeq.has(seq)) continue;
      bySeq.set(seq, {
        segmentId: traversal.segmentId,
        nearJunction: junctions.has(seq),
      });
    }
  }
  return bySeq;
};
