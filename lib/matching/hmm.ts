/**
 * Newson-Krumm HMM map matcher.
 *
 * Replaces `baseline.ts`, which snaps every fix to its nearest street
 * independently and therefore flip-flops between parallel streets, wanders at
 * junctions, and happily teleports across town between two fixes.
 *
 * The model (Newson & Krumm 2009, "Hidden Markov Map Matching Through Noise
 * and Sparseness"):
 *
 *   states       one candidate = (segment, position along it) near a fix
 *   emission     Gaussian on the perpendicular distance fix -> segment
 *   transition   exponential on |great-circle distance - on-network distance|
 *
 * The transition term is the whole point: going from street A to a parallel
 * street B 15 m away means walking to the corner and back, so the on-network
 * distance is ~200 m while the fixes moved ~15 m. That mismatch is what makes
 * the flip cost more than it is worth, and it is exactly what the baseline
 * cannot see.
 *
 * Transitions are ADJACENCY-RESTRICTED rather than Dijkstra-routed: a pair is
 * reachable only if the two candidates sit on the same segment or on segments
 * sharing a node. At ~1 Hz on foot a fix moves ~1.4 m, so consecutive fixes are
 * never more than one junction apart, and a shortest-path search per candidate
 * pair would buy nothing for a large constant factor.
 *
 * Honesty over coverage: when the model cannot connect two fixes (signal loss,
 * off-network travel, a long hole), the track is CUT into sub-trajectories and
 * the hole is reported as an unmatched span. It is never bridged by assumption
 * and it never throws.
 *
 * Server-side only by default: the segment source lazily reads from disk.
 */

import nearestPointOnLine from "@turf/nearest-point-on-line";
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
import {
  buildGraph,
  distanceToNode,
  haversineM,
  nearbySegments,
  sharedNodes,
  type GraphSegment,
  type SegmentGraph,
} from "./graph";

/* ------------------------------------------------------------------ *
 * Parameters — see README.md for the tuning notes behind each number.
 * ------------------------------------------------------------------ */

/** Contract default (`types.ts`): a fix further than this from every segment is unmatched. */
const DEFAULT_GATE_METERS = 30;
const DEFAULT_MIN_RUN_FIXES = 2;
const DEFAULT_JUNCTION_RADIUS_M = 20;

/** Emission sigma, metres. Consumer GPS in a low-rise grid. */
const DEFAULT_SIGMA_Z_M = 10;
/** Transition beta, metres. Newson-Krumm's scale for route/line mismatch. */
const DEFAULT_BETA_M = 2.0;
/** Candidates per fix. Beyond ~5 the extra states are all worse than the gate. */
const DEFAULT_MAX_CANDIDATES = 5;
/** Fixes with reported accuracy worse than this are noise, not evidence. */
const DEFAULT_MAX_ACCURACY_M = 25;
/** A fix closer than this to the previous one adds no information (standing still). */
const DEFAULT_MIN_STEP_M = 2;
/** A hole longer than this cannot be vouched for: cut, do not bridge. */
const DEFAULT_MAX_GAP_S = 30;
/** Traversals shorter than this are artifacts of noise, not passes. */
const DEFAULT_MIN_TRAVERSAL_M = 10;
/** With frames supplied, a pass needs this many to be worth reporting. */
const DEFAULT_MIN_TRAVERSAL_FRAMES = 3;
/** Weight of the heading agreement bonus. A tiebreak, never a filter. */
const DEFAULT_HEADING_WEIGHT = 0.5;
/** Speed below which a reported heading is meaningless. */
const HEADING_MIN_SPEED_MS = 0.5;
/**
 * Backtracking further than this along a segment is a real turnaround, not jitter.
 *
 * Must clear the ALONG-TRACK noise, which is the same sigma_z as the
 * perpendicular noise: at sigma 10 m a walk's `location` series routinely
 * swings 15-20 m peak-to-trough while going nowhere but forward. A real
 * turnaround retraces the block (~100 m+), so this sits well above the noise
 * and well below the signal.
 */
const DEFAULT_REVERSAL_M = 25;
/** Half-width of the smoothing window used to detect reversals. */
const REVERSAL_SMOOTH_HALF_WINDOW = 2;

/**
 * Additive options. `types.ts` is the frozen contract; these are extras with
 * defaults that reproduce the documented behaviour when omitted.
 */
export type HmmOptions = MatchOptions & {
  sigmaZMeters?: number;
  betaMeters?: number;
  maxCandidates?: number;
  maxAccuracyMeters?: number;
  minStepMeters?: number;
  maxGapSeconds?: number;
  minTraversalMeters?: number;
  minTraversalFrames?: number;
  headingWeight?: number;
  reversalMeters?: number;
};

/* ------------------------------------------------------------------ *
 * Default segment source
 * ------------------------------------------------------------------ */

let cachedDefaultSegments: MatchSegment[] | null = null;
let cachedGraph: { source: MatchSegment[]; graph: SegmentGraph } | null = null;

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

/**
 * Build the graph once per distinct segment source.
 *
 * Matching a batch of tracks against the same network is the normal case, and
 * rebuilding a 535-segment graph per call would dominate the runtime. Identity
 * (not deep equality) is the cache key: callers pass the same array back.
 */
function graphFor(segments: MatchSegment[]): SegmentGraph {
  if (cachedGraph && cachedGraph.source === segments) return cachedGraph.graph;
  const graph = buildGraph(segments);
  cachedGraph = { source: segments, graph };
  return graph;
}

/* ------------------------------------------------------------------ *
 * Geometry on a segment
 * ------------------------------------------------------------------ */

/** The vertex index whose sub-segment contains `location` metres along `seg`. */
function vertexIndexAt(seg: GraphSegment, location: number): number {
  const cum = seg.cumulative;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= location) lo = mid;
    else hi = mid;
  }
  return Math.min(lo, seg.coordinates.length - 2);
}

/** The position `location` metres along `seg`. Clamps outside the segment. */
function positionAtLocation(seg: GraphSegment, location: number): Position {
  const clamped = Math.max(0, Math.min(seg.lengthM, location));
  const i = vertexIndexAt(seg, clamped);
  const a = seg.coordinates[i];
  const b = seg.coordinates[i + 1];
  const span = seg.cumulative[i + 1] - seg.cumulative[i];
  const ratio = span > 0 ? (clamped - seg.cumulative[i]) / span : 0;
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

/** Bearing in degrees of the sub-segment containing `location`. */
function bearingAtLocation(seg: GraphSegment, location: number): number {
  const i = vertexIndexAt(seg, location);
  return bearingBetween(seg.coordinates[i], seg.coordinates[i + 1]);
}

function bearingBetween(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Positions walking `seg` from `fromLoc` to `toLoc`, inclusive of both ends.
 * Emits the real vertices in between, so the route line follows the street
 * rather than cutting its corners.
 */
function pathAlongSegment(seg: GraphSegment, fromLoc: number, toLoc: number): Position[] {
  const out: Position[] = [positionAtLocation(seg, fromLoc)];
  if (toLoc >= fromLoc) {
    for (let i = 0; i < seg.cumulative.length; i++) {
      if (seg.cumulative[i] > fromLoc && seg.cumulative[i] < toLoc) out.push(seg.coordinates[i]);
    }
  } else {
    for (let i = seg.cumulative.length - 1; i >= 0; i--) {
      if (seg.cumulative[i] < fromLoc && seg.cumulative[i] > toLoc) out.push(seg.coordinates[i]);
    }
  }
  out.push(positionAtLocation(seg, toLoc));
  return out;
}

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

type Candidate = {
  segIndex: number;
  /** Metres along the segment from its first vertex. */
  location: number;
  /** Perpendicular distance from the raw fix, metres. */
  distM: number;
  position: Position;
};

/**
 * Project one point onto one segment.
 *
 * `location` is recomputed from OUR cumulative table rather than taken from
 * turf's `location` property. The two use slightly different length maths, and
 * a location that disagrees with `cumulative` by even a metre would corrupt
 * every route distance and traversal length downstream.
 */
function locateOnSegment(seg: GraphSegment, lng: number, lat: number): Omit<Candidate, "segIndex"> {
  const snapped = nearestPointOnLine(lineString(seg.coordinates), point([lng, lat]), {
    units: "meters",
  });
  const vertex = Math.min(snapped.properties.index ?? 0, seg.coordinates.length - 1);
  const position = snapped.geometry.coordinates as Position;
  const location = Math.max(
    0,
    Math.min(seg.lengthM, seg.cumulative[vertex] + haversineM(seg.coordinates[vertex], position)),
  );
  return { location, distM: snapped.properties.dist ?? Infinity, position };
}

/**
 * The candidate states for one fix: every segment within the gate, nearest
 * first, capped.
 */
function candidatesFor(
  graph: SegmentGraph,
  fix: TrackPoint,
  gateMeters: number,
  maxCandidates: number,
): Candidate[] {
  const found: Candidate[] = [];

  for (const segIndex of nearbySegments(graph, fix.lng, fix.lat, gateMeters)) {
    const located = locateOnSegment(graph.segments[segIndex], fix.lng, fix.lat);
    if (located.distM > gateMeters) continue;
    found.push({ segIndex, ...located });
  }

  found.sort((a, b) => a.distM - b.distM);
  return found.slice(0, maxCandidates);
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/** log N(distM; 0, sigma). The constant term is dropped: it shifts every path equally. */
function logEmission(distM: number, sigmaZ: number): number {
  return -0.5 * (distM / sigmaZ) ** 2;
}

/**
 * On-network distance between two candidates, or null when unreachable.
 *
 * Reachable means same segment, or segments sharing a node — the transition
 * restriction that makes the parallel-street flip expensive.
 */
function routeDistance(
  graph: SegmentGraph,
  from: Candidate,
  to: Candidate,
): number | null {
  if (from.segIndex === to.segIndex) return Math.abs(to.location - from.location);

  const a = graph.segments[from.segIndex];
  const b = graph.segments[to.segIndex];
  let best: number | null = null;
  for (const node of sharedNodes(a, b)) {
    const da = distanceToNode(a, from.location, node);
    const db = distanceToNode(b, to.location, node);
    if (da === null || db === null) continue;
    const total = da + db;
    if (best === null || total < best) best = total;
  }
  return best;
}

/** log p(transition). Newson-Krumm: exponential on route/line mismatch. */
function logTransition(
  graph: SegmentGraph,
  from: Candidate,
  to: Candidate,
  greatCircleM: number,
  beta: number,
): number {
  const route = routeDistance(graph, from, to);
  if (route === null) return -Infinity;
  return -Math.abs(greatCircleM - route) / beta;
}

/* ------------------------------------------------------------------ *
 * Preprocessing
 * ------------------------------------------------------------------ */

type KeptFix = { fix: TrackPoint; course: number | null };

/**
 * Sort, drop the fixes that carry no signal, and precompute course.
 *
 * Course comes from a central difference over neighbouring positions rather
 * than the device's `heading`: phones report heading of the DEVICE, which on a
 * phone held in a hand while walking is mostly noise. Only computed above a
 * walking-speed floor, because a stationary fix has no direction at all.
 */
function preprocess(
  track: TrackPoint[],
  maxAccuracyM: number,
  minStepM: number,
): KeptFix[] {
  const sorted = [...track].sort((a, b) => a.t - b.t);

  const usable = sorted.filter(
    (fix) => !(typeof fix.accuracy === "number" && fix.accuracy > maxAccuracyM),
  );

  const accepted: TrackPoint[] = [];
  for (const fix of usable) {
    const prev = accepted[accepted.length - 1];
    if (prev && haversineM([prev.lng, prev.lat], [fix.lng, fix.lat]) < minStepM) continue;
    accepted.push(fix);
  }

  // The final fix is never redundant: it is what bounds the track in time.
  // Walking at ~1.4 m/s means 1 Hz fixes land ~1.4 m apart, so the step filter
  // would otherwise drop it and silently shorten every span and traversal that
  // ends the track.
  const lastUsable = usable[usable.length - 1];
  if (lastUsable && accepted[accepted.length - 1] !== lastUsable) accepted.push(lastUsable);

  return accepted.map((fix, i) => {
    const prev = accepted[i - 1];
    const next = accepted[i + 1];
    const a = prev ?? fix;
    const b = next ?? fix;
    if (a === b) return { fix, course: null };

    const dtS = (b.t - a.t) / 1000;
    const distM = haversineM([a.lng, a.lat], [b.lng, b.lat]);
    const speed =
      typeof fix.speed === "number" ? fix.speed : dtS > 0 ? distM / dtS : 0;
    if (speed <= HEADING_MIN_SPEED_MS || distM <= 0) return { fix, course: null };
    return { fix, course: bearingBetween([a.lng, a.lat], [b.lng, b.lat]) };
  });
}

/**
 * How well a candidate's street agrees with where the fix was heading.
 *
 * Streets are bidirectional, so this scores the AXIS (|cos|), not the
 * direction: walking south down a north-south street agrees with it perfectly.
 * Always <= 0, so it can only demote a candidate that runs across the motion —
 * a tiebreak between near-equal candidates, never a gate.
 */
function headingBonus(
  graph: SegmentGraph,
  candidate: Candidate,
  course: number | null,
  weight: number,
): number {
  if (course === null) return 0;
  const segBearing = bearingAtLocation(graph.segments[candidate.segIndex], candidate.location);
  const delta = ((course - segBearing) * Math.PI) / 180;
  return weight * (Math.abs(Math.cos(delta)) - 1);
}

/* ------------------------------------------------------------------ *
 * Viterbi
 * ------------------------------------------------------------------ */

type Cell = { candidate: Candidate; score: number; back: number };

/** One run of fixes the model could follow end to end. */
type SubTrajectory = {
  /** Indices into the kept-fix array. */
  fixIndices: number[];
  /** The chosen candidate per fix, parallel to `fixIndices`. */
  chosen: Candidate[];
};

/**
 * Viterbi over the kept fixes, cutting rather than failing.
 *
 * Three things end the current sub-trajectory:
 *   - a fix with no candidates at all (off-network, or beyond the gate),
 *   - a column where every transition from the previous one is impossible
 *     (a teleport: the fixes moved somewhere the network cannot connect),
 *   - a time hole longer than `maxGapS` (we cannot vouch for what happened).
 *
 * Each cut closes the current run and starts the next one fresh, so one bad
 * stretch costs exactly that stretch and never the whole track.
 */
function viterbi(
  graph: SegmentGraph,
  kept: KeptFix[],
  opts: Required<
    Pick<
      HmmOptions,
      | "gateMeters"
      | "maxCandidates"
      | "sigmaZMeters"
      | "betaMeters"
      | "maxGapSeconds"
      | "headingWeight"
    >
  >,
): { subTrajectories: SubTrajectory[]; matched: boolean[] } {
  const matched = new Array<boolean>(kept.length).fill(false);
  const subTrajectories: SubTrajectory[] = [];

  let column: Cell[] = [];
  let columnFixIndex = -1;
  // Backtrace bookkeeping for the run currently being built.
  let history: { fixIndex: number; cells: Cell[] }[] = [];

  const closeRun = () => {
    if (history.length === 0) {
      column = [];
      columnFixIndex = -1;
      return;
    }
    const last = history[history.length - 1];
    let best = 0;
    for (let i = 1; i < last.cells.length; i++) {
      if (last.cells[i].score > last.cells[best].score) best = i;
    }
    const fixIndices: number[] = [];
    const chosen: Candidate[] = [];
    let cursor = best;
    for (let h = history.length - 1; h >= 0; h--) {
      const cell = history[h].cells[cursor];
      fixIndices.push(history[h].fixIndex);
      chosen.push(cell.candidate);
      cursor = cell.back;
    }
    fixIndices.reverse();
    chosen.reverse();
    for (const i of fixIndices) matched[i] = true;
    subTrajectories.push({ fixIndices, chosen });
    history = [];
    column = [];
    columnFixIndex = -1;
  };

  for (let i = 0; i < kept.length; i++) {
    const { fix, course } = kept[i];
    const candidates = candidatesFor(graph, fix, opts.gateMeters, opts.maxCandidates);

    if (candidates.length === 0) {
      // Nothing within the gate: this fix is off-network. Cut here.
      closeRun();
      continue;
    }

    const emissions = candidates.map(
      (c) =>
        logEmission(c.distM, opts.sigmaZMeters) +
        headingBonus(graph, c, course, opts.headingWeight),
    );

    const gapS =
      columnFixIndex >= 0 ? (fix.t - kept[columnFixIndex].fix.t) / 1000 : 0;
    const startFresh = column.length === 0 || gapS > opts.maxGapSeconds;

    if (startFresh) {
      // A hole we cannot vouch for: close what we had, begin anew.
      if (column.length > 0) closeRun();
      column = candidates.map((candidate, k) => ({
        candidate,
        score: emissions[k],
        back: -1,
      }));
      columnFixIndex = i;
      history.push({ fixIndex: i, cells: column });
      continue;
    }

    const prevFix = kept[columnFixIndex].fix;
    const greatCircleM = haversineM([prevFix.lng, prevFix.lat], [fix.lng, fix.lat]);

    const next: Cell[] = [];
    for (let k = 0; k < candidates.length; k++) {
      let bestScore = -Infinity;
      let bestBack = -1;
      for (let j = 0; j < column.length; j++) {
        if (column[j].score === -Infinity) continue;
        const lt = logTransition(
          graph,
          column[j].candidate,
          candidates[k],
          greatCircleM,
          opts.betaMeters,
        );
        if (lt === -Infinity) continue;
        const score = column[j].score + lt;
        if (score > bestScore) {
          bestScore = score;
          bestBack = j;
        }
      }
      next.push({
        candidate: candidates[k],
        score: bestScore === -Infinity ? -Infinity : bestScore + emissions[k],
        back: bestBack,
      });
    }

    if (next.every((c) => c.score === -Infinity)) {
      // Every path died: the network cannot connect the last fix to this one.
      // Close the run and restart HERE rather than dropping the fix.
      closeRun();
      column = candidates.map((candidate, k) => ({
        candidate,
        score: emissions[k],
        back: -1,
      }));
      columnFixIndex = i;
      history.push({ fixIndex: i, cells: column });
      continue;
    }

    column = next;
    columnFixIndex = i;
    history.push({ fixIndex: i, cells: column });
  }

  closeRun();
  return { subTrajectories, matched };
}

/* ------------------------------------------------------------------ *
 * Route + passes
 * ------------------------------------------------------------------ */

/**
 * One pass along one segment: a contiguous range of fixes, entered at
 * `entryLoc` and left at `exitLoc`.
 *
 * The pass — not the individual fix — is the unit of route geometry. A fix's
 * `location` is the foot of the perpendicular from a noisy point, so it jitters
 * several metres back and forth even on a dead-straight walk. Measuring travel
 * by summing |delta location| between fixes therefore integrates the NOISE:
 * measured that way a real 120 m walk came out at 664 m. Entry-to-exit
 * displacement is immune to that, and it is what `lengthM` means in the
 * contract ("metres travelled along the segment during this pass").
 */
type Pass = {
  id: number;
  segIndex: number;
  /** Local fix indices within the sub-trajectory, contiguous. */
  from: number;
  to: number;
  entryLoc: number;
  exitLoc: number;
  lengthM: number;
  /** Cumulative route distance at the start / end of this pass. */
  sStart: number;
  sEnd: number;
  positions: Position[];
  frameSeqs: number[];
  nearJunctionSeqs: number[];
};

/** A maximal run of consecutive fixes matched to the same segment. */
type Run = { segIndex: number; from: number; to: number };

/**
 * Smooth a location series for reversal DETECTION only.
 *
 * Detection runs on the smoothed series; the pass boundaries it returns index
 * the original one. A centred mean over 5 samples cuts the noise by ~sqrt(5)
 * while blurring a real turnaround by only a couple of metres, which is what
 * lets a threshold sit cleanly between jitter and a genuine about-face.
 */
function smoothSeries(values: number[], halfWindow: number): number[] {
  return values.map((_, i) => {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(values.length - 1, i + halfWindow);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += values[k];
    return sum / (hi - lo + 1);
  });
}

/**
 * Split a run of fixes on one segment at genuine turnarounds.
 *
 * The contract is explicit that an out-and-back is TWO traversals, not one
 * merged span: which pass a frame belongs to is what tells us which side of the
 * street was filmed. This is the ZigZag rule — track the extremum reached in
 * the current direction and pivot only once the series retraces past it by more
 * than `reversalM` — run over the smoothed series so GPS jitter on a straight
 * walk cannot manufacture a turnaround.
 */
function splitAtReversals(
  rawLocations: number[],
  reversalM: number,
): number[][] {
  if (rawLocations.length < 2) return [rawLocations.map((_, i) => i)];

  const locations = smoothSeries(rawLocations, REVERSAL_SMOOTH_HALF_WINDOW);
  const groups: number[][] = [];
  let current: number[] = [0];
  let direction = 0;
  let extremum = locations[0];

  for (let i = 1; i < locations.length; i++) {
    if (direction === 0) {
      // Warm-up: do NOT take the direction from the first step. Noise makes the
      // opening delta a coin flip, and a direction set backwards turns the walk
      // that follows into a "reversal" — which reported the first few seconds
      // of every track as its own doomed little pass. Commit only once the walk
      // has actually gone somewhere.
      if (Math.abs(locations[i] - locations[0]) > reversalM) {
        direction = Math.sign(locations[i] - locations[0]);
        extremum = locations[i];
      }
      current.push(i);
      continue;
    }

    const backtrack = direction > 0 ? extremum - locations[i] : locations[i] - extremum;
    if (backtrack > reversalM) {
      // A real turnaround. Cut at the extremum and start the return pass there.
      let pivot = current.length - 1;
      for (let k = current.length - 1; k >= 0; k--) {
        const better =
          direction > 0
            ? locations[current[k]] >= locations[current[pivot]]
            : locations[current[k]] <= locations[current[pivot]];
        if (better) pivot = k;
      }
      const cut = current.slice(0, pivot + 1);
      const rest = current.slice(pivot);
      groups.push(cut);
      current = [...rest, i];
      direction = -direction;
      extremum = locations[i];
      continue;
    }

    if (direction > 0 ? locations[i] > extremum : locations[i] < extremum) {
      extremum = locations[i];
    }
    current.push(i);
  }

  groups.push(current);
  return groups.filter((g) => g.length > 0);
}

/** Maximal runs of consecutive fixes on one segment. */
function maximalRuns(chosen: Candidate[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.segIndex === chosen[i].segIndex) last.to = i;
    else runs.push({ segIndex: chosen[i].segIndex, from: i, to: i });
  }
  return runs;
}

/**
 * How much of the segment a run covers: its extent, not its net displacement.
 *
 * Net displacement (|end - start|) is WRONG here, and dangerously so: a walk up
 * a street and back ends where it began, so its net displacement is ~0 and the
 * whole run would be discarded as too short to be real — reporting no coverage
 * at all for a street that was walked twice. Extent asks the question actually
 * being asked at this stage: how much of this street did this run cover? The
 * reversal split later cuts the run into its two monotonic legs, and each leg
 * is measured entry-to-exit.
 */
function runExtent(chosen: Candidate[], run: Run): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = run.from; i <= run.to; i++) {
    if (chosen[i].location < min) min = chosen[i].location;
    if (chosen[i].location > max) max = chosen[i].location;
  }
  return max - min;
}

/**
 * Group a sub-trajectory's fixes into passes.
 *
 * At a junction the two arms MEET, so a fix sitting on the corner is genuinely
 * near-equidistant from both and the Viterbi flickers between them for a fix or
 * two. That flicker is not a pass along a street; it is what `minRunFixes` and
 * `minTraversalMeters` exist to kill. So: keep only the runs strong enough to
 * be real, give every remaining fix to its nearest strong run, and let adjacent
 * runs of the same segment merge back into one pass. Absorbing rather than
 * blanking matters — merely dropping the flicker would leave one true pass
 * reported as two separated by a hole, which is the artifact this removes.
 */
function buildPasses(
  graph: SegmentGraph,
  chosen: Candidate[],
  fixes: TrackPoint[],
  minRunFixes: number,
  minTraversalM: number,
  reversalM: number,
  startId: number,
): { passes: Pass[]; locations: number[] } {
  if (chosen.length === 0) return { passes: [], locations: [] };

  const runs = maximalRuns(chosen);
  const strong = runs.filter(
    (r) => r.to - r.from + 1 >= minRunFixes && runExtent(chosen, r) >= minTraversalM,
  );
  // Nothing here was a pass: a handful of fixes brushing past a street.
  if (strong.length === 0) return { passes: [], locations: [] };

  // Every fix joins the strong run nearest in time. Strong runs are ordered and
  // disjoint, so ownership is monotonic and the resulting blocks are contiguous.
  const blocks: Run[] = [];
  for (let i = 0; i < chosen.length; i++) {
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < strong.length; k++) {
      const r = strong[k];
      const d = i < r.from ? r.from - i : i > r.to ? i - r.to : 0;
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    const segIndex = strong[best].segIndex;
    const last = blocks[blocks.length - 1];
    if (last && last.segIndex === segIndex) last.to = i;
    else blocks.push({ segIndex, from: i, to: i });
  }

  // An absorbed fix was matched to a DIFFERENT segment, so its `location` is a
  // distance along that other street and means nothing here. Re-project it onto
  // the segment it now belongs to; using the stale value reported a 3-second
  // pass as 142 m of travel.
  const locations = chosen.map((c) => c.location);
  for (const block of blocks) {
    for (let i = block.from; i <= block.to; i++) {
      if (chosen[i].segIndex === block.segIndex) continue;
      locations[i] = locateOnSegment(
        graph.segments[block.segIndex],
        fixes[i].lng,
        fixes[i].lat,
      ).location;
    }
  }

  // An out-and-back on one street is two passes, not one merged span.
  const split: Run[] = [];
  for (const block of blocks) {
    const series: number[] = [];
    for (let i = block.from; i <= block.to; i++) series.push(locations[i]);
    for (const group of splitAtReversals(series, reversalM)) {
      split.push({
        segIndex: block.segIndex,
        from: block.from + group[0],
        to: block.from + group[group.length - 1],
      });
    }
  }

  const passes = split.map((run, j) => {
    const seg = graph.segments[run.segIndex];
    const prev = split[j - 1];
    const next = split[j + 1];
    // A pass entered from an adjacent street starts at the node they share, not
    // at the first fix: the walk really did cover the metres up to the corner.
    const entryLoc =
      prev && prev.segIndex !== run.segIndex
        ? boundaryLocation(seg, graph.segments[prev.segIndex], locations[run.from])
        : locations[run.from];
    const exitLoc =
      next && next.segIndex !== run.segIndex
        ? boundaryLocation(seg, graph.segments[next.segIndex], locations[run.to])
        : locations[run.to];

    return {
      id: startId + j,
      segIndex: run.segIndex,
      from: run.from,
      to: run.to,
      entryLoc,
      exitLoc,
      lengthM: Math.abs(exitLoc - entryLoc),
      sStart: 0,
      sEnd: 0,
      positions: pathAlongSegment(seg, entryLoc, exitLoc),
      frameSeqs: [],
      nearJunctionSeqs: [],
    };
  });

  return { passes, locations };
}

/**
 * Where `seg` meets `other`: the location on `seg` of the node they share.
 * Falls back to the fix's own location when they share none.
 */
function boundaryLocation(
  seg: GraphSegment,
  other: GraphSegment,
  fallback: number,
): number {
  const shared = sharedNodes(seg, other);
  if (shared.length === 0) return fallback;
  let bestLoc = fallback;
  let bestDist = Infinity;
  for (const node of shared) {
    const loc = seg.startNode === node ? 0 : seg.lengthM;
    const d = Math.abs(loc - fallback);
    if (d < bestDist) {
      bestDist = d;
      bestLoc = loc;
    }
  }
  return bestLoc;
}

/**
 * Lay the passes end to end into one route, and place every fix on it.
 *
 * `fixS` is forced non-decreasing: within a pass the walk goes one way (that is
 * what the reversal split guarantees), so a fix whose noisy projection lands
 * behind its predecessor is noise, and letting it move route distance backwards
 * would break the binary search that attribution depends on.
 */
function layoutRoute(passes: Pass[], locations: number[]): number[] {
  let s = 0;
  for (const pass of passes) {
    pass.sStart = s;
    pass.sEnd = s + pass.lengthM;
    s = pass.sEnd;
  }

  const fixS = new Array<number>(locations.length).fill(0);
  let running = 0;
  for (const pass of passes) {
    for (let i = pass.from; i <= pass.to; i++) {
      const along = Math.abs(locations[i] - pass.entryLoc);
      const value = Math.max(pass.sStart, Math.min(pass.sEnd, pass.sStart + along));
      running = Math.max(running, value);
      fixS[i] = running;
    }
  }
  return fixS;
}

/* ------------------------------------------------------------------ *
 * matchTrack
 * ------------------------------------------------------------------ */

type Built = {
  sub: SubTrajectory;
  /** Every pass the walk made, in order. The route is these laid end to end. */
  passes: Pass[];
  /** Route distance at each fix of the sub-trajectory. */
  fixS: number[];
  /** The passes worth reporting as traversals; a subset of `passes`. */
  reported: Pass[];
};

export const matchTrack: MatchTrack = (track, options: MatchOptions = {}): MatchResult => {
  const opts = options as HmmOptions;
  const gateMeters = opts.gateMeters ?? DEFAULT_GATE_METERS;
  const minRunFixes = opts.minRunFixes ?? DEFAULT_MIN_RUN_FIXES;
  const junctionRadiusM = opts.junctionRadiusM ?? DEFAULT_JUNCTION_RADIUS_M;
  const sigmaZMeters = opts.sigmaZMeters ?? DEFAULT_SIGMA_Z_M;
  const betaMeters = opts.betaMeters ?? DEFAULT_BETA_M;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxAccuracyMeters = opts.maxAccuracyMeters ?? DEFAULT_MAX_ACCURACY_M;
  const minStepMeters = opts.minStepMeters ?? DEFAULT_MIN_STEP_M;
  const maxGapSeconds = opts.maxGapSeconds ?? DEFAULT_MAX_GAP_S;
  const minTraversalMeters = opts.minTraversalMeters ?? DEFAULT_MIN_TRAVERSAL_M;
  const minTraversalFrames = opts.minTraversalFrames ?? DEFAULT_MIN_TRAVERSAL_FRAMES;
  const headingWeight = opts.headingWeight ?? DEFAULT_HEADING_WEIGHT;
  const reversalMeters = opts.reversalMeters ?? DEFAULT_REVERSAL_M;

  const sortedTrack = [...track].sort((a, b) => a.t - b.t);
  if (sortedTrack.length === 0) {
    return { traversals: [], unmatchedSpans: [], routeLine: emptyLine() };
  }

  const segments = opts.segments ?? loadDefaultSegments();
  const graph = graphFor(segments);
  const kept = preprocess(sortedTrack, maxAccuracyMeters, minStepMeters);

  if (kept.length === 0) {
    // Every fix was noise: the whole track is a hole, reported as one span.
    return {
      traversals: [],
      unmatchedSpans: [
        { tStart: sortedTrack[0].t, tEnd: sortedTrack[sortedTrack.length - 1].t },
      ],
      routeLine: rawLine(sortedTrack),
    };
  }

  const { subTrajectories, matched } = viterbi(graph, kept, {
    gateMeters,
    maxCandidates,
    sigmaZMeters,
    betaMeters,
    maxGapSeconds,
    headingWeight,
  });

  /* ---- passes + route per sub-trajectory ---- */

  const built: Built[] = [];
  let passId = 0;
  for (const sub of subTrajectories) {
    const { passes, locations } = buildPasses(
      graph,
      sub.chosen,
      sub.fixIndices.map((i) => kept[i].fix),
      minRunFixes,
      minTraversalMeters,
      reversalMeters,
      passId,
    );
    passId += passes.length;
    const fixS = layoutRoute(passes, locations);
    // The reversal split can carve a sliver off a pass, so re-apply the floor
    // to what gets REPORTED. The route still keeps every pass: the walk went
    // there, we just will not call a sliver a traversal of the street.
    const reported = passes.filter(
      (p) => p.lengthM >= minTraversalMeters && p.to - p.from + 1 >= minRunFixes,
    );
    built.push({ sub, passes, fixS, reported });
  }

  /* ---- frames ---- */

  const frames = opts.frames ? [...opts.frames].sort((a, b) => a.t - b.t) : [];
  if (frames.length > 0) {
    for (const frame of frames) {
      const hit = attributeFrameToRoute(graph, built, kept, frame, junctionRadiusM);
      if (!hit) continue;
      hit.pass.frameSeqs.push(frame.seq);
      if (hit.nearJunction) hit.pass.nearJunctionSeqs.push(frame.seq);
    }
    // A pass nobody filmed is not evidence of coverage: reported, it would
    // claim a stretch of street that no frame can be read from.
    for (const b of built) {
      b.reported = b.reported.filter((p) => p.frameSeqs.length >= minTraversalFrames);
    }
  }

  /* ---- traversals ---- */

  const traversals: SegmentTraversal[] = [];
  for (const b of built) {
    for (const pass of b.reported) {
      const first = kept[b.sub.fixIndices[pass.from]].fix;
      const last = kept[b.sub.fixIndices[pass.to]].fix;
      traversals.push({
        segmentId: graph.segments[pass.segIndex].id,
        tEnter: first.t,
        tExit: last.t,
        lengthM: pass.lengthM,
        frameSeqs: pass.frameSeqs,
        nearJunctionSeqs: pass.nearJunctionSeqs,
      });
    }
  }
  traversals.sort((a, b) => a.tEnter - b.tEnter);

  /* ---- unmatched spans ---- */

  const unmatchedSpans = buildUnmatchedSpans(kept, matched, subTrajectories);

  /* ---- route line ---- */

  // The route is what the walk travelled, so it is drawn from every pass, not
  // only the reported ones.
  const routePositions: Position[] = [];
  for (const b of built) {
    for (const pass of b.passes) {
      for (const pos of pass.positions) pushPosition(routePositions, pos);
    }
  }
  if (routePositions.length === 0) {
    for (const { fix } of kept) pushPosition(routePositions, [fix.lng, fix.lat]);
  }

  return {
    traversals,
    unmatchedSpans,
    routeLine:
      routePositions.length >= 2
        ? lineString(routePositions).geometry
        : { type: "LineString", coordinates: [routePositions[0], routePositions[0]] },
  };
};

function pushPosition(out: Position[], pos: Position) {
  const last = out[out.length - 1];
  if (last && last[0] === pos[0] && last[1] === pos[1]) return;
  out.push(pos);
}

function emptyLine(): LineString {
  return { type: "LineString", coordinates: [] };
}

function rawLine(track: TrackPoint[]): LineString {
  const positions: Position[] = track.map((f) => [f.lng, f.lat]);
  return positions.length >= 2
    ? lineString(positions).geometry
    : { type: "LineString", coordinates: [positions[0], positions[0]] };
}

/**
 * The stretches of time we cannot account for.
 *
 * Two sources, both real gaps: fixes that matched nothing, and the seam between
 * two sub-trajectories (the model refused to bridge it). Reporting the seam
 * matters — silently joining two runs would claim we observed a stretch of
 * street that we did not.
 */
function buildUnmatchedSpans(
  kept: KeptFix[],
  matched: boolean[],
  subTrajectories: SubTrajectory[],
): UnmatchedSpan[] {
  const spans: UnmatchedSpan[] = [];

  let runStart = -1;
  for (let i = 0; i < kept.length; i++) {
    if (!matched[i]) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      spans.push({ tStart: kept[runStart].fix.t, tEnd: kept[i - 1].fix.t });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    spans.push({ tStart: kept[runStart].fix.t, tEnd: kept[kept.length - 1].fix.t });
  }

  // Seams between consecutive sub-trajectories that are adjacent in time (no
  // unmatched fix between them) are holes too: a cut means the model could not
  // connect them.
  for (let i = 1; i < subTrajectories.length; i++) {
    const prevLast = subTrajectories[i - 1].fixIndices[subTrajectories[i - 1].fixIndices.length - 1];
    const nextFirst = subTrajectories[i].fixIndices[0];
    if (nextFirst !== prevLast + 1) continue;
    const tStart = kept[prevLast].fix.t;
    const tEnd = kept[nextFirst].fix.t;
    if (tEnd > tStart) spans.push({ tStart, tEnd });
  }

  spans.sort((a, b) => a.tStart - b.tStart);
  return spans;
}

/**
 * Place one frame on the route.
 *
 * Time -> route distance by interpolating between the bracketing fixes, then a
 * binary search of the step table. Interpolating along the ROUTE rather than
 * along straight lines between fixes is what keeps a frame shot mid-block from
 * landing on the cross street.
 */
function attributeFrameToRoute(
  graph: SegmentGraph,
  built: Built[],
  kept: KeptFix[],
  frame: FrameTime,
  junctionRadiusM: number,
): { pass: Pass; nearJunction: boolean } | null {
  for (const b of built) {
    const fixes = b.sub.fixIndices;
    const tFirst = kept[fixes[0]].fix.t;
    const tLast = kept[fixes[fixes.length - 1]].fix.t;
    if (frame.t < tFirst || frame.t > tLast) continue;

    // Bracketing fixes within this sub-trajectory.
    let i = 0;
    while (i < fixes.length - 1 && kept[fixes[i + 1]].fix.t < frame.t) i++;
    const tA = kept[fixes[i]].fix.t;
    const tB = kept[fixes[Math.min(i + 1, fixes.length - 1)]].fix.t;
    const sA = b.fixS[i];
    const sB = b.fixS[Math.min(i + 1, b.fixS.length - 1)];
    const ratio = tB > tA ? (frame.t - tA) / (tB - tA) : 0;
    const s = sA + (sB - sA) * ratio;

    const pass = findPass(b.passes, s);
    if (!pass) return null;

    const seg = graph.segments[pass.segIndex];
    const span = pass.sEnd - pass.sStart;
    const t = span > 0 ? (s - pass.sStart) / span : 0;
    const location = pass.entryLoc + (pass.exitLoc - pass.entryLoc) * t;
    const pos = positionAtLocation(seg, location);

    const nearJunction = [seg.startNode, seg.endNode].some((node) => {
      const nodePos = graph.nodePositions.get(node);
      return nodePos ? haversineM(pos, nodePos) <= junctionRadiusM : false;
    });

    return { pass, nearJunction };
  }
  return null;
}

/** The pass containing route distance `s`. Passes are laid end to end, so this is a binary search. */
function findPass(passes: Pass[], s: number): Pass | null {
  if (passes.length === 0) return null;
  let lo = 0;
  let hi = passes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (passes[mid].sEnd < s) lo = mid + 1;
    else hi = mid;
  }
  return passes[lo] ?? null;
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
