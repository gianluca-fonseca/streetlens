/**
 * Shared types for the CV capture funnel.
 *
 * This file is the contract every later capture unit builds against: ingest,
 * map matching, frame extraction, rollups and the review UI all import from
 * here. Treat it as authoritative and additive — widening a union or adding an
 * optional field is fine, renaming a field is a breaking change for four units
 * at once.
 *
 * The extraction vocabulary is NOT invented here. It is rubric v0.1, the same
 * 15 items a human field auditor scores (`scripts/generate-demo-audits.mjs`),
 * so a CV observation and a field audit stay directly comparable. If the rubric
 * gains an item, both places change together.
 *
 * Runtime validation lives in `lib/capture/schemas.ts`; this file is types only
 * (plus the two frozen lookup tables), so it is safe to import from the browser.
 */

import type { LineString } from "geojson";

/* ------------------------------------------------------------------ *
 * Track + frames
 * ------------------------------------------------------------------ */

/**
 * One GPS fix from a capture run.
 *
 * `t` is epoch milliseconds UTC — always absolute, never relative to the start
 * of the run. A device clock can be wrong; `capture_sessions.clock_offset_ms`
 * records the correction rather than mutating the fixes, so the raw track stays
 * exactly what the device reported.
 */
export type TrackPoint = {
  lat: number;
  lng: number;
  /** Epoch ms, UTC. */
  t: number;
  /** Horizontal accuracy in metres, when the device reports it. */
  accuracy?: number;
  /** Degrees clockwise from true north. */
  heading?: number;
  /** Metres per second. */
  speed?: number;
};

/** Where a finalized track came from. */
export type TrackSource = "live" | "gpx" | "trace";

/** How the frames were produced. */
export type CaptureSessionMode = "live" | "video";

/**
 * Metadata for one captured frame, as the client registers it BEFORE uploading
 * the bytes. Registration is what authorizes the storage write (see the storage
 * RLS policy in `0013_capture.sql`), so this shape is a security boundary, not
 * just bookkeeping.
 *
 * `seq` is dense and 0-based within a session and is the frame's identity: the
 * storage path derives from it, and re-registering the same seq is idempotent.
 */
export type CaptureFrameMeta = {
  seq: number;
  /** Capture time, epoch ms UTC. Matched against the track to place the frame. */
  t: number;
  /** Storage object path — always `captureFrameStoragePath(sessionId, seq)`. */
  storagePath: string;
  width: number;
  height: number;
  bytes: number;
  /**
   * Variance-of-Laplacian sharpness, higher = sharper. Optional because the
   * client computes it best-effort; a missing score never blocks upload.
   */
  blurScore?: number;
};

/* ------------------------------------------------------------------ *
 * Session lifecycle
 * ------------------------------------------------------------------ */

/**
 * Capture session status.
 *
 * Happy path: pending_upload → uploading → matching → extracting → review_ready
 *             → approved | rejected
 *
 * Off-path: `cost_paused` is a deliberate stop, not an error — the extraction
 * budget ran out mid-session and a human must resume it, so the frames survive.
 * `failed` is terminal and unrecoverable.
 */
export type CaptureSessionStatus =
  | "pending_upload"
  | "uploading"
  | "matching"
  | "extracting"
  | "cost_paused"
  | "review_ready"
  | "approved"
  | "rejected"
  | "failed";

export const CAPTURE_SESSION_STATUSES: readonly CaptureSessionStatus[] = [
  "pending_upload",
  "uploading",
  "matching",
  "extracting",
  "cost_paused",
  "review_ready",
  "approved",
  "rejected",
  "failed",
] as const;

/** Statuses that still accept frame uploads. Mirrored by the storage RLS policy. */
export const CAPTURE_UPLOADABLE_STATUSES: readonly CaptureSessionStatus[] = [
  "pending_upload",
  "uploading",
] as const;

/** Per-frame extraction job state. `failed_overbudget` is distinct from `failed`: retryable once budget returns. */
export type CaptureJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "failed_overbudget";

/* ------------------------------------------------------------------ *
 * Rubric v0.1 vocabulary
 * ------------------------------------------------------------------ */

/**
 * The 15 rubric v0.1 item keys, in rubric order. Mirrors RUBRIC_ITEMS in
 * `scripts/generate-demo-audits.mjs` exactly — a CV observation must be
 * comparable to a human audit item-for-item.
 */
export const RUBRIC_ITEM_KEYS = [
  "sidewalk_present",
  "sidewalk_width",
  "surface_condition",
  "curb_ramp",
  "obstruction_free",
  "drain_present",
  "standing_water",
  "curb_gutter",
  "canopy_cover",
  "midday_shade",
  "lighting",
  "crossing_safety",
  "bike_lane_present",
  "bike_separation",
  "bike_surface",
] as const;

export type RubricItemKey = (typeof RUBRIC_ITEM_KEYS)[number];

/** Response encoding for a rubric item (matches `rubric_items.response_type`). */
export type RubricResponseType = "boolean" | "scale_0_4" | "percent";

/**
 * Item key → response type. Drives per-item validation: the encodings are
 * boolean → 0|1, scale_0_4 → 0..4, percent → 0..100. Higher is always better
 * (note `standing_water` is phrased "No standing-water evidence").
 */
export const RUBRIC_ITEM_RESPONSE_TYPES: Readonly<
  Record<RubricItemKey, RubricResponseType>
> = {
  sidewalk_present: "boolean",
  sidewalk_width: "scale_0_4",
  surface_condition: "scale_0_4",
  curb_ramp: "boolean",
  obstruction_free: "scale_0_4",
  drain_present: "boolean",
  standing_water: "scale_0_4",
  curb_gutter: "scale_0_4",
  canopy_cover: "percent",
  midday_shade: "scale_0_4",
  lighting: "scale_0_4",
  crossing_safety: "scale_0_4",
  bike_lane_present: "boolean",
  bike_separation: "scale_0_4",
  bike_surface: "scale_0_4",
} as const;

/** Item key → scoring lens, so per-item results roll up to the five map layers. */
export const RUBRIC_ITEM_LAYERS: Readonly<
  Record<RubricItemKey, "accessibility" | "drainage" | "shade" | "overall" | "bike">
> = {
  sidewalk_present: "accessibility",
  sidewalk_width: "accessibility",
  surface_condition: "accessibility",
  curb_ramp: "accessibility",
  obstruction_free: "accessibility",
  drain_present: "drainage",
  standing_water: "drainage",
  curb_gutter: "drainage",
  canopy_cover: "shade",
  midday_shade: "shade",
  lighting: "overall",
  crossing_safety: "overall",
  bike_lane_present: "bike",
  bike_separation: "bike",
  bike_surface: "bike",
} as const;

/* ------------------------------------------------------------------ *
 * Observations (per-frame extraction output)
 * ------------------------------------------------------------------ */

/**
 * What a model may emit for an item value. Booleans are accepted on the wire
 * because a vision model asked for a yes/no naturally returns JSON `true` —
 * `lib/capture/schemas.ts` normalizes them to 0|1 on parse.
 */
export type CaptureItemValueInput = number | boolean | null;

/**
 * A canonical item value AFTER parsing: numeric or `null`. `null` is a
 * first-class answer meaning "not assessable from this frame" (the pole is out
 * of shot, the crossing is behind the camera). It is NOT a zero, and rollups
 * must skip it rather than score it.
 */
export type CaptureItemValue = number | null;

/** One item's extracted result. `confidence` is 0..1. */
export type CaptureObservationItem = {
  value: CaptureItemValue;
  /** Model self-reported confidence, 0..1. Weights the median in rollups. */
  confidence: number;
};

/**
 * Whether the frame could be scored at all. An unusable frame (motion blur,
 * lens flare, a passing truck filling the shot) is recorded rather than
 * dropped, so coverage math can tell "we looked and could not see" apart from
 * "we never looked".
 */
export type CaptureFrameQuality = {
  usable: boolean;
  /** Short machine-ish reason when `usable` is false, e.g. "motion_blur". */
  reason?: string;
};

/** Observation schema version. Bump when item semantics change, not on additions. */
export const CAPTURE_SCHEMA_VERSION = "cv-v1" as const;
export type CaptureSchemaVersion = typeof CAPTURE_SCHEMA_VERSION;

/**
 * One frame's extraction result — exactly the 15 rubric items, plus quality and
 * provenance.
 *
 * Deliberately carries no segment id and no `nearJunction`: those are frame
 * ATTRIBUTION, derived from the track by `lib/matching`, and a model must never
 * be in a position to assert them. Keeping them off this shape makes that
 * mistake unrepresentable.
 */
export type CaptureObservation = {
  schemaVersion: CaptureSchemaVersion;
  /** Extracting model id, e.g. "gpt-5-mini". Recorded per observation for A/B and cost attribution. */
  model: string;
  items: Record<RubricItemKey, CaptureObservationItem>;
  frameQuality: CaptureFrameQuality;
  /**
   * One short, plain-language sentence or three describing what the model saw and
   * why the notable scores are what they are ("Narrow paved road, no sidewalk on
   * either side; dense canopy left; standing water at the right edge"). This is a
   * per-FRAME rationale, not per-item: it exists for a human reviewer, who reads
   * one honest paragraph far faster than 15 justifications. Stored on the
   * observation row (0020); old rows predate it and simply have none.
   */
  rationale: string;
};

/* ------------------------------------------------------------------ *
 * Storage path convention
 * ------------------------------------------------------------------ */

/** Storage bucket for capture frames (created in `0013_capture.sql`). */
export const CAPTURE_BUCKET = "streetlens-frames" as const;

/** Hard ceilings, echoed to the client by POST /api/capture/sessions. */
export const CAPTURE_LIMITS = {
  /** Frames per session. */
  maxFrames: 400,
  /** Bytes per frame — must equal the bucket's file_size_limit in 0013. */
  maxFrameBytes: 2_097_152,
} as const;

/** `captures/<sessionId>/` — the per-session storage prefix. */
export function captureStoragePrefix(sessionId: string): string {
  return `captures/${sessionId}`;
}

/**
 * `captures/<sessionId>/frame-0007.jpg` — the ONE storage path convention.
 *
 * Zero-padded to 4 digits so paths sort lexicographically in the same order the
 * frames were shot (which is why maxFrames is 400, not 40_000). The storage RLS
 * policy re-derives this path server-side, so a client cannot register one path
 * and upload to another.
 */
export function captureFrameStoragePath(sessionId: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > 9999) {
    throw new RangeError(`frame seq out of range: ${seq}`);
  }
  return `${captureStoragePrefix(sessionId)}/frame-${String(seq).padStart(4, "0")}.jpg`;
}

/* ------------------------------------------------------------------ *
 * Matching hand-off (see lib/matching for the algorithms)
 * ------------------------------------------------------------------ */

/** A frame placed onto the network by `lib/matching`. */
export type FrameAttribution = {
  /** Matched segment, or `null` when the fix fell outside the gate. */
  segmentId: string | null;
  /**
   * True when the frame sits near a junction, where a photo shows the crossing
   * rather than the mid-block street. Junction-sensitive items (curb_ramp,
   * crossing_safety) are read from these frames; the rest are not.
   */
  nearJunction: boolean;
};

/* ------------------------------------------------------------------ *
 * Database row types (mirror supabase/migrations/0013_capture.sql)
 * ------------------------------------------------------------------ */

export type CaptureSessionRow = {
  id: string;
  mode: CaptureSessionMode;
  status: CaptureSessionStatus;
  /** GeoJSON LineString (PostGIS geography serialized), or null before finalize. */
  track: LineString | null;
  clock_offset_ms: number;
  frame_count: number;
  source_ip_hash: string | null;
  contact: string | null;
  created_at: string;
  uploaded_at: string | null;
  matched_at: string | null;
  extracted_at: string | null;
  reviewed_at: string | null;
};

export type CaptureFrameRow = {
  id: string;
  session_id: string;
  seq: number;
  storage_path: string;
  t: number;
  /** GeoJSON Point, or null when the frame could not be placed. */
  location: { type: "Point"; coordinates: [number, number] } | null;
  width: number;
  height: number;
  bytes: number;
  blur_score: number | null;
  segment_id: string | null;
  near_junction: boolean;
  created_at: string;
};
