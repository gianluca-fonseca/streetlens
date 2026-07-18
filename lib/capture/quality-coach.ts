/**
 * In-walk quality coaching — gentle hints from signals already on the device.
 *
 * Pure and testable; thresholds live in tuning.ts.
 */

import type { DropCounts } from "@/components/capture/engine/gating";
import { totalDropped } from "@/components/capture/engine/session";
import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";

export type CoachHintId = "gps_poor" | "moving_fast" | "too_dark" | "stationary";

export type CoachHint = Readonly<{
  id: CoachHintId;
  /** Higher = more urgent within the non-blocking coach rail. */
  priority: number;
}>;

export type CoachInput = Readonly<{
  accuracyM: number | null;
  dropCounts: DropCounts;
  framesKept: number;
  meanGray: number | null;
  speedMps: number | null;
}>;

/** Fast walking / jogging — above typical sidewalk pace. */
export const SPEED_WARN_MPS = 2.5;

/** Mean gray thumbnail level below which the scene is probably too dark. */
export const DARK_GRAY_THRESHOLD = 45;

const STATIONARY_DISPLACEMENT_RATIO = 0.55;

/**
 * Derive live coaching hints. Returns at most two, highest priority first.
 * Nothing here blocks recording.
 */
export function deriveCoachHints(input: CoachInput): readonly CoachHint[] {
  const hints: CoachHint[] = [];
  const dropped = totalDropped(input.dropCounts);
  const seen = input.framesKept + dropped;

  if (input.accuracyM !== null && input.accuracyM >= CAPTURE_TUNING.accuracyWarnM) {
    hints.push({ id: "gps_poor", priority: 90 });
  }

  if (input.meanGray !== null && input.meanGray < DARK_GRAY_THRESHOLD && seen >= 8) {
    hints.push({ id: "too_dark", priority: 70 });
  }

  if (input.speedMps !== null && input.speedMps > SPEED_WARN_MPS && seen >= 5) {
    hints.push({ id: "moving_fast", priority: 60 });
  }

  if (seen >= 12 && input.framesKept > 0) {
    const displacementShare = input.dropCounts.displacement / Math.max(1, dropped);
    if (displacementShare >= STATIONARY_DISPLACEMENT_RATIO) {
      hints.push({ id: "stationary", priority: 50 });
    }
  }

  return hints.sort((a, b) => b.priority - a.priority).slice(0, 2);
}

/** Rolling mean gray level from a 32×32 thumbnail. */
export function updateMeanGray(current: number | null, sample: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < sample.length; i += 1) sum += sample[i];
  const next = sum / sample.length;
  if (current === null) return next;
  return current * 0.85 + next * 0.15;
}
