/**
 * Pre-upload readiness summary — frames, duration, coverage estimate, quality flags.
 */

import type { DropCounts } from "@/components/capture/engine/gating";
import { totalDropped } from "@/components/capture/engine/session";
import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";
import type { TrackPoint } from "@/lib/capture/types";
import { haversineMeters } from "@/components/capture/engine/geo";

export type GateItemStatus = "ok" | "warn" | "block";

export type GateItemId =
  | "frames"
  | "fixes"
  | "duration"
  | "track_length"
  | "gps_quality"
  | "drop_ratio";

export type GateItem = Readonly<{
  id: GateItemId;
  status: GateItemStatus;
  /** i18n key suffix under collect.gate.items.<id> */
  hintKey?: string;
  value?: string;
}>;

export type UploadGateResult = Readonly<{
  items: readonly GateItem[];
  /** Advisory block — only when upload would certainly fail. */
  blocked: boolean;
  coverageEstimateM: number;
}>;

const MIN_FRAMES_OK = 8;
const MIN_TRACK_M = 30;
const WARN_DROP_RATIO = 0.75;

function trackLengthM(track: readonly TrackPoint[]): number {
  if (track.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    total += haversineMeters(
      { lat: a.lat, lng: a.lng },
      { lat: b.lat, lng: b.lng },
    );
  }
  return total;
}

function meanAccuracy(track: readonly TrackPoint[]): number | null {
  const samples = track
    .map((p) => p.accuracy)
    .filter((a): a is number => typeof a === "number" && Number.isFinite(a));
  if (samples.length === 0) return null;
  return samples.reduce((s, v) => s + v, 0) / samples.length;
}

export function assessUploadReadiness(input: {
  framesKept: number;
  dropCounts: DropCounts;
  elapsedMs: number;
  track: readonly TrackPoint[];
  accuracyM: number | null;
}): UploadGateResult {
  const items: GateItem[] = [];
  const dropped = totalDropped(input.dropCounts);
  const seen = input.framesKept + dropped;
  const dropRatio = seen > 0 ? dropped / seen : 0;
  const trackM = trackLengthM(input.track);
  const meanAcc = meanAccuracy(input.track);

  if (input.framesKept === 0) {
    items.push({ id: "frames", status: "block", hintKey: "frames_none" });
  } else if (input.framesKept < MIN_FRAMES_OK) {
    items.push({
      id: "frames",
      status: "warn",
      hintKey: "frames_low",
      value: String(input.framesKept),
    });
  } else {
    items.push({
      id: "frames",
      status: "ok",
      value: String(input.framesKept),
    });
  }

  if (input.track.length < 2) {
    items.push({ id: "fixes", status: "block", hintKey: "fixes_low" });
  } else {
    items.push({ id: "fixes", status: "ok", value: String(input.track.length) });
  }

  const minutes = Math.round(input.elapsedMs / 60_000);
  items.push({
    id: "duration",
    status: minutes < 1 ? "warn" : "ok",
    hintKey: minutes < 1 ? "duration_short" : undefined,
    value: String(minutes),
  });

  if (trackM < MIN_TRACK_M) {
    items.push({
      id: "track_length",
      status: "warn",
      hintKey: "track_short",
      value: String(Math.round(trackM)),
    });
  } else {
    items.push({
      id: "track_length",
      status: "ok",
      value: String(Math.round(trackM)),
    });
  }

  const acc = input.accuracyM ?? meanAcc;
  if (acc !== null && acc >= CAPTURE_TUNING.accuracyWarnM) {
    items.push({
      id: "gps_quality",
      status: "warn",
      hintKey: "gps_poor",
      value: String(Math.round(acc)),
    });
  } else if (acc !== null) {
    items.push({
      id: "gps_quality",
      status: "ok",
      value: String(Math.round(acc)),
    });
  } else {
    items.push({ id: "gps_quality", status: "warn", hintKey: "gps_unknown" });
  }

  if (dropRatio >= WARN_DROP_RATIO && seen >= 10) {
    const topReason =
      input.dropCounts.displacement >= input.dropCounts.blurry
        ? "drops_displacement"
        : input.dropCounts.blurry > 0
          ? "drops_blurry"
          : "drops_high";
    items.push({
      id: "drop_ratio",
      status: "warn",
      hintKey: topReason,
      value: `${Math.round(dropRatio * 100)}%`,
    });
  } else {
    items.push({
      id: "drop_ratio",
      status: dropped === 0 ? "ok" : "ok",
      value: dropped === 0 ? "0" : String(dropped),
    });
  }

  const blocked = items.some((i) => i.status === "block");
  const coverageEstimateM = Math.max(trackM, input.framesKept * CAPTURE_TUNING.minDisplacementM * 0.6);

  return { items, blocked, coverageEstimateM };
}
