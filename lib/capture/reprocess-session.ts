/**
 * Re-run map matching on a capture session (UI/API wrapper around 0019 RPC).
 *
 * Mirrors scripts/reprocess-capture-session.mjs but runs in-process via the real
 * HMM matcher — no throwaway tsc compile step.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { attributeFrames, matchTrack } from "@/lib/matching";
import type { MatchSegment } from "@/lib/matching";
import type { CaptureDb } from "./db";

export type ReprocessPreview = {
  total: number;
  attributed: number;
  unmatched: number;
  bySegment: Record<string, number>;
  currentlyUnmatched: number;
  status: string;
  frameCount: number;
};

export type ReprocessResult = ReprocessPreview & {
  reprocessed: number;
  requeued: number;
  noop: boolean;
  status: string;
};

type TrackVertex = { lng: number; lat: number };
type FrameTime = { seq: number; t: number };

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function haversine(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rebuild matcher-ready track from stored vertices and frame times. */
export function buildTrackFromSession(
  trackVerts: readonly TrackVertex[],
  frames: readonly FrameTime[],
): { lng: number; lat: number; t: number }[] {
  if (trackVerts.length === 0 || frames.length === 0) return [];
  const times = frames.map((f) => f.t).filter((t) => Number.isFinite(t));
  if (times.length === 0) return [];
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const span = tMax - tMin;

  const cum = [0];
  for (let i = 1; i < trackVerts.length; i++) {
    cum.push(cum[i - 1]! + haversine(trackVerts[i - 1]!, trackVerts[i]!));
  }
  const total = cum[cum.length - 1]!;

  return trackVerts.map((v, i) => {
    const frac = total > 0 ? cum[i]! / total : 0;
    return { lng: v.lng, lat: v.lat, t: Math.round(tMin + frac * span) };
  });
}

export function buildAttributionPayload(
  frames: readonly FrameTime[],
  attribution: Map<number, { segmentId: string | null; nearJunction: boolean }>,
): { seq: number; segmentId: string | null; nearJunction: boolean }[] {
  return frames.map((f) => {
    const hit = attribution.get(f.seq);
    return {
      seq: f.seq,
      segmentId: hit?.segmentId ?? null,
      nearJunction: hit?.nearJunction ?? false,
    };
  });
}

export function summarizeAttribution(
  frames: readonly FrameTime[],
  attribution: Map<number, { segmentId: string | null; nearJunction: boolean }>,
): Omit<ReprocessPreview, "status" | "frameCount" | "currentlyUnmatched"> {
  const bySegment: Record<string, number> = {};
  let attributed = 0;
  let unmatched = 0;
  for (const f of frames) {
    const segmentId = attribution.get(f.seq)?.segmentId ?? null;
    if (segmentId) {
      attributed += 1;
      bySegment[segmentId] = (bySegment[segmentId] ?? 0) + 1;
    } else {
      unmatched += 1;
    }
  }
  return { total: frames.length, attributed, unmatched, bySegment };
}

async function loadNetworkSegments(): Promise<MatchSegment[]> {
  const geojsonPath = path.join(process.cwd(), "data", "segments.geojson");
  const parsed = JSON.parse(await fs.readFile(geojsonPath, "utf8")) as {
    features?: { geometry?: { type?: string; coordinates?: [number, number][] }; properties?: { id?: string } }[];
  };
  return (parsed.features ?? [])
    .filter(
      (f) =>
        f.geometry?.type === "LineString" &&
        typeof f.properties?.id === "string" &&
        Array.isArray(f.geometry.coordinates),
    )
    .map((f) => ({
      id: f.properties!.id!,
      coordinates: f.geometry!.coordinates!,
    }));
}

export type ReprocessSessionArgs = {
  db: CaptureDb;
  sessionId: string;
  dryRun?: boolean;
};

/** Preview or commit a reprocess run. Throws on unrecoverable errors. */
export async function reprocessSession({
  db,
  sessionId,
  dryRun = false,
}: ReprocessSessionArgs): Promise<ReprocessResult> {
  const trackPayload = await db.sessionTrack(sessionId);
  const status = trackPayload.status;
  const track = trackPayload.track;
  const frameCount = trackPayload.frameCount;

  if (status === "approved" || status === "rejected") {
    throw new Error(`session already decided (${status})`);
  }
  if (status !== "extracting" && status !== "review_ready") {
    throw new Error(`session not reprocessable (status ${status})`);
  }
  if (track.length < 2) {
    throw new Error("session has no usable track");
  }

  const frameRows = await db.listFrames(sessionId);
  if (frameRows.length === 0) {
    throw new Error("session has no frames");
  }

  const frames = frameRows.map((r) => ({ seq: r.seq, t: Number(r.t) }));
  const currentlyUnmatched = frameRows.filter((r) => r.segment_id == null).length;

  const segments = await loadNetworkSegments();
  const reTrack = buildTrackFromSession(track, frames);
  const match = matchTrack(reTrack, { frames, segments });
  const attribution = attributeFrames(match, frames);
  const summary = summarizeAttribution(frames, attribution);
  const payload = buildAttributionPayload(frames, attribution);

  const preview: ReprocessPreview = {
    ...summary,
    currentlyUnmatched,
    status,
    frameCount,
  };

  if (dryRun) {
    return {
      ...preview,
      reprocessed: 0,
      requeued: 0,
      noop: true,
      status,
    };
  }

  const result = await db.reprocessSession(sessionId, payload);
  return {
    ...preview,
    reprocessed: result.reprocessed,
    requeued: result.requeued,
    noop: result.noop,
    status: result.status,
  };
}
