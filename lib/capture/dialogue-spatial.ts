/**
 * Build the spatial block inputs for a dialogue call from review + network data.
 *
 * Assembled FRESH at each invocation — never persisted as standing model context.
 */

import { buildGraph, type SegmentGraph } from "@/lib/matching/graph";
import type { MatchSegment } from "@/lib/matching/types";
import type { SessionReview, ReviewFrame } from "@/lib/capture/review-store";
import type { SegmentMeta } from "@/lib/capture/segment-label";
import { haversineMeters } from "@/lib/extraction/synthesis";
import {
  classifyAnchors,
  metersAlongPolyline,
  type FrameAlongSegment,
  type SpatialBlockInput,
  type SpatialNeighbors,
  type SpatialSegmentIdentity,
} from "@/lib/extraction/guided-context";

export type SegmentGeometryMeta = SegmentMeta & {
  highway?: string | null;
  lengthM?: number | null;
  coordinates?: [number, number][];
};

export type BuildSpatialArgs = {
  segmentId: string;
  review: SessionReview;
  /** Geometry + labels for the walked segment. */
  segment: SegmentGeometryMeta | null;
  /** Full network for neighbor lookup (ids + optional display names). */
  network: MatchSegment[];
  /** Display names keyed by segment id (from getSegments / page props). */
  nameById?: Map<string, string>;
  /** Seq numbers the latest message cited (positions only for these). */
  referencedSeqs: readonly number[];
};

function polylineLengthM(coordinates: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    total += haversineMeters(
      { lng: coordinates[i][0], lat: coordinates[i][1] },
      { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] },
    );
  }
  return total;
}

function neighborsFor(
  graph: SegmentGraph,
  segmentId: string,
  nameById: Map<string, string>,
): SpatialNeighbors {
  const idx = graph.byId.get(segmentId);
  if (idx === undefined) return { atStart: [], atEnd: [] };
  const seg = graph.segments[idx];

  const namesAt = (node: string): string[] => {
    const idxs = graph.nodeToSegments.get(node) ?? [];
    const out: string[] = [];
    for (const i of idxs) {
      const other = graph.segments[i];
      if (other.id === segmentId) continue;
      out.push(nameById.get(other.id) ?? other.id);
    }
    return [...new Set(out)].sort((a, b) => a.localeCompare(b));
  };

  return { atStart: namesAt(seg.startNode), atEnd: namesAt(seg.endNode) };
}

function framePosition(
  frame: ReviewFrame,
  coordinates: [number, number][] | undefined,
  lengthM: number | null,
): FrameAlongSegment {
  const loc = frame.position;
  const alongM =
    coordinates && coordinates.length >= 2
      ? metersAlongPolyline(coordinates, loc)
      : null;

  let fraction: number | null = null;
  if (alongM !== null) {
    const denom =
      lengthM !== null && lengthM > 0
        ? lengthM
        : coordinates && coordinates.length >= 2
          ? polylineLengthM(coordinates)
          : 0;
    if (denom > 0) fraction = Math.max(0, Math.min(1, alongM / denom));
  }

  return {
    seq: frame.seq,
    alongM,
    fraction,
    nearJunction: frame.nearJunction,
    location: loc,
  };
}

/**
 * Build spatial block input for one dialogue invocation.
 */
export function buildDialogueSpatial(args: BuildSpatialArgs): SpatialBlockInput {
  const { segmentId, review, segment, network, referencedSeqs } = args;
  const nameById = args.nameById ?? new Map<string, string>();
  if (segment?.name) nameById.set(segmentId, segment.name);

  const identity: SpatialSegmentIdentity = {
    id: segmentId,
    name: segment?.name ?? null,
    district: segment?.district ?? null,
    highway: segment?.highway ?? null,
    lengthM: segment?.lengthM ?? null,
  };

  const segFrames = review.frames.filter((f) => f.segmentId === segmentId && !f.deleted);
  const coordinates = segment?.coordinates;
  const lengthM = segment?.lengthM ?? null;

  const allPositions = segFrames.map((f) => framePosition(f, coordinates, lengthM));
  const anchors = classifyAnchors(allPositions);

  const refSet = new Set(referencedSeqs);
  const referencedPositions = allPositions.filter((p) => refSet.has(p.seq));

  let neighbors: SpatialNeighbors = { atStart: [], atEnd: [] };
  try {
    if (network.length > 0) {
      const graph = buildGraph(network);
      neighbors = neighborsFor(graph, segmentId, nameById);
    }
  } catch {
    neighbors = { atStart: [], atEnd: [] };
  }

  const rollup = review.segments.find((s) => s.segmentId === segmentId);

  return {
    identity,
    direction: "along matched segment geometry (start→end)",
    frameCount: segFrames.length,
    coveragePct: rollup?.coverage ?? null,
    matchConfidence: rollup?.confidence ?? null,
    anchors,
    neighbors,
    referencedPositions,
  };
}
