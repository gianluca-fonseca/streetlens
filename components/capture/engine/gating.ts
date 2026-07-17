/**
 * The keep-or-drop decision for a candidate frame.
 *
 * Every frame the camera delivers passes through here, and the answer is either
 * "keep" or "drop, for exactly one stated reason". The reasons are enumerated
 * rather than boolean because the walker is shown them: a session that captured
 * 12 frames and dropped 300 is not a bug report, it is a phone that was pointed
 * at a wall, and the HUD should be able to say which.
 *
 * Pure and DOM-free so `scripts/test-capture-gating.mjs` can pin the thresholds.
 * Ordering inside `evaluateFrame` is deliberate: cheap scalar gates first, pixel
 * work last, so a stationary phone costs almost nothing.
 */

import { frameDelta, laplacianVariance } from "@/components/capture/engine/frame-analysis";
import { haversineMeters } from "@/components/capture/engine/geo";
import { CAPTURE_TUNING, type CaptureTuning } from "@/components/capture/engine/tuning";

/**
 * Why a frame was not kept.
 *
 * - `no_fix` — no usable GPS yet. A frame we cannot place is worthless to us.
 * - `cadence` — arrived too soon after the last kept frame.
 * - `displacement` — the phone has not moved far enough since the last kept frame.
 * - `duplicate` — visually identical to the previous frame.
 * - `blurry` — too soft to score.
 */
export type DropReason = "no_fix" | "cadence" | "displacement" | "duplicate" | "blurry";

export const DROP_REASONS: readonly DropReason[] = [
  "no_fix",
  "cadence",
  "displacement",
  "duplicate",
  "blurry",
] as const;

export type DropCounts = Record<DropReason, number>;

export function emptyDropCounts(): DropCounts {
  return { no_fix: 0, cadence: 0, displacement: 0, duplicate: 0, blurry: 0 };
}

export type FrameVerdict =
  | { keep: true; blurScore: number }
  | { keep: false; reason: DropReason; blurScore: number | null };

export type LatLng = Readonly<{ lat: number; lng: number }>;

/** The candidate frame, already reduced to a gray thumbnail. */
export type FrameCandidate = Readonly<{
  now: number;
  position: LatLng | null;
  gray: Uint8Array;
  graySize: number;
}>;

/** What the gates remember about the last frame we actually kept. */
export type GateMemory = Readonly<{
  lastKeptT: number | null;
  lastKeptPosition: LatLng | null;
  /** Gray thumbnail of the previous CANDIDATE, kept or not. */
  prevGray: Uint8Array | null;
}>;

/**
 * Decide the fate of one candidate frame.
 *
 * The first frame of a session has no `lastKeptT`, so the motion gates cannot
 * apply and are skipped: it still has to clear dedupe and blur. Dedupe compares
 * against the previous CANDIDATE rather than the previous KEPT frame, because
 * the thing it defends against (a hidden video redelivering one frame forever)
 * shows up between candidates.
 */
export function evaluateFrame(
  candidate: FrameCandidate,
  memory: GateMemory,
  tuning: CaptureTuning = CAPTURE_TUNING,
): FrameVerdict {
  if (candidate.position === null) {
    return { keep: false, reason: "no_fix", blurScore: null };
  }

  const isFirst = memory.lastKeptT === null || memory.lastKeptPosition === null;

  if (!isFirst) {
    if (candidate.now - (memory.lastKeptT as number) < tuning.minIntervalMs) {
      return { keep: false, reason: "cadence", blurScore: null };
    }
    const moved = haversineMeters(candidate.position, memory.lastKeptPosition as LatLng);
    if (moved < tuning.minDisplacementM) {
      return { keep: false, reason: "displacement", blurScore: null };
    }
  }

  if (frameDelta(candidate.gray, memory.prevGray) < tuning.duplicateDelta) {
    return { keep: false, reason: "duplicate", blurScore: null };
  }

  const blurScore = laplacianVariance(candidate.gray, candidate.graySize);
  if (blurScore < tuning.blurVariance) {
    return { keep: false, reason: "blurry", blurScore };
  }

  return { keep: true, blurScore };
}

/** Why a session stopped on its own. */
export type SessionCapReason = "frame_cap" | "duration_cap";

/**
 * Whether a session has hit a hard cap and must stop gracefully.
 *
 * `maxFrames` is the frozen contract value from `lib/capture/types.ts`, passed in
 * rather than re-declared, so this file cannot drift from the storage limit.
 */
export function sessionCapReached(
  params: Readonly<{
    frameCount: number;
    startedAt: number;
    now: number;
    maxFrames: number;
  }>,
  tuning: CaptureTuning = CAPTURE_TUNING,
): SessionCapReason | null {
  if (params.frameCount >= params.maxFrames) return "frame_cap";
  if (params.now - params.startedAt >= tuning.maxDurationMs) return "duration_cap";
  return null;
}
