/**
 * StreetLens data-layer types.
 *
 * Two families live here:
 *  1. Database row types mirroring the SQL in `supabase/migrations/*` — used by
 *     the Supabase client and by anything that reads live rows.
 *  2. Adapter/view types (`ScoreLayer`, `SegmentProperties`, `SegmentCollection`,
 *     `SegmentDetail`, `Stats`) — the shapes the UI consumes. `SegmentProperties`
 *     is byte-for-byte the shape `components/AuditMap.tsx` (owned by u1) reads off
 *     each GeoJSON feature, so it must not drift.
 */

import type { FeatureCollection, LineString, Feature } from "geojson";

/* ------------------------------------------------------------------ *
 * Adapter / view types (interop contract with the UI unit)
 * ------------------------------------------------------------------ */

/** The five scoring lenses. Exactly one is active on the map at a time. */
export type ScoreLayer =
  | "overall"
  | "accessibility"
  | "drainage"
  | "shade"
  | "bike";

export const SCORE_LAYERS: readonly ScoreLayer[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
  "bike",
] as const;

/**
 * Ley 7600 accessibility pass threshold. A segment scoring below this on the
 * accessibility layer is considered to fail the legal minimum. Used to derive
 * the headline hero stat.
 */
export const LEY_7600_MIN_SCORE = 50;

/**
 * Provenance of a segment. `audit` is the rubric-audited reference dataset;
 * `community` is an approved anonymous contribution; `import` is an admin bulk
 * import. Community (and unverified import) segments carry NO rubric scores.
 */
export type SegmentSource = "audit" | "community" | "import";

/**
 * A community report: a qualitative note attached to a segment. Produced by an
 * approved `update_segment` submission (attached to the target segment) or by an
 * approved `add_segment` (embedded on the new community segment). NEVER a score.
 */
export type CommunityReport = {
  id: string;
  /** The segment this report is about (an existing id, or the community add's own id). */
  segment_id: string;
  note: string;
  /** Provenance back to the originating submission, when applicable. */
  submission_id: string | null;
  created_at: string;
};

/**
 * Properties carried on every segment GeoJSON feature. Consumed by AuditMap.
 * Flat shape (contract v2, advisor rev 1 u6): the four original 0-100 `score_*`
 * fields plus `score_bike`, `district`, and `audited_at`.
 *
 * Contract v3 (u7, adjudicated): additive OPTIONAL provenance fields. Existing
 * audited features leave them unset (or `source:"audit", verified:true`);
 * community/import features set them. Nothing that read v2 breaks.
 */
export type SegmentProperties = {
  id: string;
  name: string;
  district: string;
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  score_bike: number;
  audited_at: string;
  demo: boolean;
  /** Provenance; absent (or "audit") on the reference dataset. */
  source?: SegmentSource;
  /** Whether the segment is field-verified. Community adds are always false. */
  verified?: boolean;
  /** Embedded report for a community add (its own condition note, not a score). */
  community_report?: CommunityReport | null;
  /** Reports contributed against this segment (community update_segment approvals). */
  community_reports?: CommunityReport[];
};

export type SegmentFeature = Feature<LineString, SegmentProperties>;
export type SegmentCollection = FeatureCollection<LineString, SegmentProperties>;

/** A single rubric-item response within an audit, denormalized for display. */
export type ObservationDetail = {
  item_key: string;
  label_en: string;
  label_es: string;
  layer: ScoreLayer;
  /** Normalized response 0..1 (higher = better). */
  response: number;
  note: string | null;
  photos: PhotoDetail[];
};

export type PhotoDetail = {
  storage_path: string;
  taken_at: string;
};

/** Full detail for one segment: geometry, scores, and its (demo) audit. */
export type SegmentDetail = {
  id: string;
  name: string;
  district: string;
  audited_at: string;
  highway: string;
  length_m: number;
  demo: boolean;
  geometry: LineString;
  scores: Record<ScoreLayer, number>;
  audit: {
    audited_on: string;
    auditor: string;
    rubric_version_id: string;
    observations: ObservationDetail[];
  } | null;
};

/** Aggregate stats for the floating hero panel. */
export type StreetStats = {
  /** Number of audited (rubric-scored) segments. Community adds are excluded. */
  segments: number;
  /** Total audited length in kilometers. */
  km: number;
  /** Audited street length as a percent of the district street network. */
  coveragePct: number;
  /** Headline figure: percent of audited segments failing Ley 7600 minimums. */
  heroPct: number;
  /**
   * Contract v3 (u7): count of community/import segments in the read path,
   * tallied SEPARATELY from `segments` so unverified contributions never inflate
   * the official audited figure.
   */
  communitySegments: number;
};

/**
 * A community/import segment as persisted in `data/community-segments.local.json`
 * (local mode) or the `community_segments` table (DB mode). Carries geometry and
 * provenance but NO rubric scores — it renders with the neutral community casing
 * until a field audit verifies it.
 */
export type CommunitySegment = {
  id: string;
  name: string;
  highway: string;
  district: string;
  source: Extract<SegmentSource, "community" | "import">;
  verified: boolean;
  /** Auditor name for a verified field-team import; null otherwise. */
  auditor: string | null;
  /** Provenance back to the originating submission (community adds); null for imports. */
  submission_id: string | null;
  /** LineString positions [lng, lat]. */
  coordinates: [number, number][];
  /** The contributor's condition note as a report (community adds); null for imports. */
  community_report: CommunityReport | null;
  created_at: string;
};

/* ------------------------------------------------------------------ *
 * Database row types (mirror supabase/migrations)
 * ------------------------------------------------------------------ */

export type CantonRow = {
  id: string;
  name: string;
};

export type DistrictRow = {
  id: string;
  canton_id: string;
  name: string;
};

export type CorridorRow = {
  id: string;
  district_id: string;
  name: string;
};

export type SegmentRow = {
  id: string;
  corridor_id: string | null;
  canton_id: string;
  district_id: string;
  name: string;
  highway: string;
  length_m: number;
  /** GeoJSON LineString (PostGIS geometry serialized to GeoJSON). */
  geom: LineString;
  demo: boolean;
};

export type RubricVersionRow = {
  id: string;
  label: string;
  frozen_at: string | null;
  is_active: boolean;
};

export type RubricItemRow = {
  id: string;
  version_id: string;
  key: string;
  label_en: string;
  label_es: string;
  layer: ScoreLayer;
  ordering: number;
  response_type: "scale_0_4" | "boolean" | "percent";
};

export type AuditRow = {
  id: string;
  segment_id: string;
  audited_on: string;
  auditor: string;
  rubric_version_id: string;
  demo: boolean;
};

export type ObservationRow = {
  id: string;
  audit_id: string;
  item_id: string;
  response: number;
  note: string | null;
};

export type PhotoRow = {
  id: string;
  observation_id: string;
  storage_path: string;
  taken_at: string;
};

export type SubmissionType = "add_segment" | "update_segment";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export type SubmissionRow = {
  id: string;
  type: SubmissionType;
  payload: unknown;
  status: SubmissionStatus;
  reviewed_at: string | null;
  reviewer_note: string | null;
  source_ip_hash: string | null;
  honeypot_tripped: boolean;
  created_at: string;
};
