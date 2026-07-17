/**
 * The segment graph: the routable network the HMM's transition model walks.
 *
 * The baseline matcher has no topology, so it will happily put fix N on one
 * street and fix N+1 on a parallel street 15 m away. Everything that fixes
 * that lives here: which segments touch which, and how far apart two points on
 * the network really are when you have to travel between them.
 *
 * Server-safe and pure: build it from `MatchSegment[]`, it reads nothing.
 */

import RBush from "rbush";
import type { Position } from "geojson";
import type { MatchSegment } from "./types";

/** Metres per degree of latitude. Good to ~0.5% anywhere; we only pad bboxes with it. */
const M_PER_DEG_LAT = 111_320;

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. The only distance we trust across the network. */
export function haversineM(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * A node key: the exact coordinate string.
 *
 * This looks fragile and is not. `data/segments.geojson` and
 * `data/routing-network.geojson` are both 6-decimal rounded and byte-identical
 * at shared vertices, so segments that meet share a coordinate EXACTLY. A
 * tolerance-based join would be slower and would fuse distinct corners of a
 * tight junction; exact string identity is what the data actually guarantees.
 * If a future dataset breaks that guarantee, this is the single place to change.
 */
export function nodeKey(c: Position): string {
  return `${c[0]},${c[1]}`;
}

export type GraphSegment = {
  id: string;
  coordinates: Position[];
  /** [minLng, minLat, maxLng, maxLat] — computed from geometry, never read from a file. */
  bbox: [number, number, number, number];
  /** Cumulative distance from coordinates[0] to each vertex, metres. */
  cumulative: number[];
  /** Total length in metres. */
  lengthM: number;
  startNode: string;
  endNode: string;
};

type IndexEntry = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  segIndex: number;
};

export type SegmentGraph = {
  segments: GraphSegment[];
  byId: Map<string, number>;
  /** node key -> indices of every segment touching that node. */
  nodeToSegments: Map<string, number[]>;
  /** segment index -> indices of segments sharing at least one endpoint node. */
  adjacency: Map<number, number[]>;
  tree: RBush<IndexEntry>;
  /** Every junction node position, for the near-junction test. */
  nodePositions: Map<string, Position>;
};

/**
 * Build the graph.
 *
 * FOOTGUN, deliberately avoided: `data/segments.geojson` carries a
 * `metadata.bbox` in Overpass's LAT-FIRST order ([minLat, minLng, maxLat,
 * maxLng]), which is NOT the GeoJSON convention. Reading it would silently
 * transpose every gate check into the ocean. Bboxes here are always computed
 * from the geometry.
 */
export function buildGraph(segments: MatchSegment[]): SegmentGraph {
  const graphSegments: GraphSegment[] = [];
  const byId = new Map<string, number>();
  const nodeToSegments = new Map<string, number[]>();
  const nodePositions = new Map<string, Position>();
  const entries: IndexEntry[] = [];

  for (const seg of segments) {
    if (seg.coordinates.length < 2) continue;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    const cumulative: number[] = [0];

    for (let i = 0; i < seg.coordinates.length; i++) {
      const [lng, lat] = seg.coordinates[i];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      if (i > 0) {
        cumulative.push(
          cumulative[i - 1] + haversineM(seg.coordinates[i - 1], seg.coordinates[i]),
        );
      }
    }

    const first = seg.coordinates[0];
    const last = seg.coordinates[seg.coordinates.length - 1];
    const startNode = nodeKey(first);
    const endNode = nodeKey(last);
    const segIndex = graphSegments.length;

    graphSegments.push({
      id: seg.id,
      coordinates: seg.coordinates,
      bbox: [minLng, minLat, maxLng, maxLat],
      cumulative,
      lengthM: cumulative[cumulative.length - 1],
      startNode,
      endNode,
    });
    byId.set(seg.id, segIndex);
    nodePositions.set(startNode, first);
    nodePositions.set(endNode, last);

    // A loop segment (start === end) must not list itself twice as a neighbour.
    for (const key of startNode === endNode ? [startNode] : [startNode, endNode]) {
      const list = nodeToSegments.get(key);
      if (list) list.push(segIndex);
      else nodeToSegments.set(key, [segIndex]);
    }

    entries.push({
      minX: minLng,
      minY: minLat,
      maxX: maxLng,
      maxY: maxLat,
      segIndex,
    });
  }

  // Adjacency: two segments are neighbours iff they share an endpoint node.
  // Mid-line crossings are NOT adjacency — a road bridging over another is not
  // a turn you can take, and this dataset splits real junctions into endpoints.
  const adjacency = new Map<number, number[]>();
  for (const [, segIndices] of nodeToSegments) {
    for (const a of segIndices) {
      let list = adjacency.get(a);
      if (!list) {
        list = [];
        adjacency.set(a, list);
      }
      for (const b of segIndices) {
        if (a !== b && !list.includes(b)) list.push(b);
      }
    }
  }

  const tree = new RBush<IndexEntry>();
  tree.load(entries);

  return { segments: graphSegments, byId, nodeToSegments, adjacency, tree, nodePositions };
}

/** Degree padding for a metre radius at this latitude, for the bbox prefilter. */
export function degreePadding(
  meters: number,
  lat: number,
): { dLng: number; dLat: number } {
  const dLat = meters / M_PER_DEG_LAT;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
  return { dLat, dLng: meters / (M_PER_DEG_LAT * cos) };
}

/** Segment indices whose bbox is within `radiusM` of the point. Cheap prefilter only. */
export function nearbySegments(
  graph: SegmentGraph,
  lng: number,
  lat: number,
  radiusM: number,
): number[] {
  const { dLng, dLat } = degreePadding(radiusM, lat);
  return graph.tree
    .search({
      minX: lng - dLng,
      minY: lat - dLat,
      maxX: lng + dLng,
      maxY: lat + dLat,
    })
    .map((e) => e.segIndex);
}

/**
 * Distance from a point at `location` metres along `seg` to one of its end nodes.
 * The two ways off a segment; the transition model needs both.
 */
export function distanceToNode(
  seg: GraphSegment,
  location: number,
  node: string,
): number | null {
  if (seg.startNode === node && seg.endNode === node) {
    // A loop: leave by whichever end is closer.
    return Math.min(location, seg.lengthM - location);
  }
  if (seg.startNode === node) return location;
  if (seg.endNode === node) return seg.lengthM - location;
  return null;
}

/** The node keys two segments share, if any. */
export function sharedNodes(a: GraphSegment, b: GraphSegment): string[] {
  const shared: string[] = [];
  for (const key of a.startNode === a.endNode ? [a.startNode] : [a.startNode, a.endNode]) {
    if (b.startNode === key || b.endNode === key) shared.push(key);
  }
  return shared;
}
