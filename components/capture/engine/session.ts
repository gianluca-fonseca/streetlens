/**
 * The on-device session manifest.
 *
 * This is the recorder's own record of a walk, and it is deliberately NOT one of
 * the frozen wire contracts. `lib/capture/*` describes what the server accepts;
 * this describes what survives on the phone between a walk and a successful
 * upload. It carries things the server never sees (drop counts, sub-segments,
 * which frames are already uploaded) and is written to OPFS after every kept
 * frame, so a browser that is killed mid-walk loses one frame, not the walk.
 *
 * `localId` exists because a walk starts before the server knows about it: the
 * real `sessionId` only arrives from `createSession` at upload time. Frames are
 * therefore staged under the local id and the storage path is rewritten during
 * upload (`uploadCapture` derives the canonical path from the real session id,
 * so nothing here can forge one).
 *
 * Bumping `MANIFEST_VERSION` invalidates recovered sessions rather than trying to
 * migrate them. A stale half-walk is not worth a migration path.
 */

import type { CaptureFrameMeta, TrackPoint } from "@/lib/capture/types";
import { type DropCounts, DROP_REASONS, emptyDropCounts } from "@/components/capture/engine/gating";

export const MANIFEST_VERSION = 1 as const;

/**
 * A contiguous stretch of recording.
 *
 * Backgrounding the tab ends a sub-segment and returning starts a new one. We do
 * not pretend the gap did not happen: the walker physically kept walking while
 * the camera was dead, so the track has a hole and the frames on either side are
 * not continuous. Downstream matching needs to know that.
 */
export type SessionSegment = {
  index: number;
  startedAt: number;
  endedAt: number | null;
};

/** Where a stored session is in its life. */
export type SessionPhase = "recording" | "ready_to_upload" | "uploading" | "uploaded";

export type SessionManifest = {
  version: typeof MANIFEST_VERSION;
  localId: string;
  /** Set once `createSession` succeeds; lets a retry resume instead of duplicating. */
  serverSessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  phase: SessionPhase;
  frames: CaptureFrameMeta[];
  track: TrackPoint[];
  segments: SessionSegment[];
  dropCounts: DropCounts;
  contact: string | null;
};

export function createManifest(localId: string, startedAt: number): SessionManifest {
  return {
    version: MANIFEST_VERSION,
    localId,
    serverSessionId: null,
    startedAt,
    endedAt: null,
    phase: "recording",
    frames: [],
    track: [],
    segments: [{ index: 0, startedAt, endedAt: null }],
    dropCounts: emptyDropCounts(),
    contact: null,
  };
}

/** Close the open sub-segment, if there is one. */
export function closeSegment(manifest: SessionManifest, at: number): SessionManifest {
  const segments = manifest.segments.map((segment) =>
    segment.endedAt === null ? { ...segment, endedAt: at } : segment,
  );
  return { ...manifest, segments };
}

/** Close any open sub-segment and open a fresh one. Used on resume-after-background. */
export function openSegment(manifest: SessionManifest, at: number): SessionManifest {
  const closed = closeSegment(manifest, at);
  return {
    ...closed,
    segments: [...closed.segments, { index: closed.segments.length, startedAt: at, endedAt: null }],
  };
}

/** Total dropped frames across every reason. */
export function totalDropped(counts: DropCounts): number {
  return DROP_REASONS.reduce((sum, reason) => sum + counts[reason], 0);
}

/**
 * A session is worth offering to recover only if it could actually be uploaded.
 *
 * `finalizeRequestSchema` requires a track of at least two fixes and there is
 * nothing to upload without frames, so anything less is debris to be swept, not
 * a decision to put in front of a walker.
 */
export function isRecoverable(manifest: SessionManifest): boolean {
  return (
    manifest.phase !== "uploaded" && manifest.frames.length > 0 && manifest.track.length >= 2
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Structural check for a manifest read back off disk.
 *
 * OPFS content is our own, but it is also arbitrarily old and was written by a
 * possibly different build. This is a shape guard so a stale file surfaces as
 * "discard this" rather than a runtime crash on load. It intentionally does not
 * revalidate frame/track contents against the zod schemas: those run at upload
 * time, where a rejection can be reported honestly.
 */
export function isSessionManifest(value: unknown): value is SessionManifest {
  if (!isRecord(value)) return false;
  if (value.version !== MANIFEST_VERSION) return false;
  if (typeof value.localId !== "string" || value.localId.length === 0) return false;
  if (typeof value.startedAt !== "number") return false;
  if (!Array.isArray(value.frames) || !Array.isArray(value.track)) return false;
  if (!Array.isArray(value.segments)) return false;
  const dropCounts = value.dropCounts;
  if (!isRecord(dropCounts)) return false;
  return DROP_REASONS.every((reason) => typeof dropCounts[reason] === "number");
}
