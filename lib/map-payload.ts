/**
 * Public map wire shape — paint-only FeatureCollection properties and scrubbed
 * CV observations for the click-time detail fetch.
 */

import type {
  CommunityReport,
  CvObservation,
  ScoreLayer,
  SegmentFeature,
  SegmentProperties,
} from "./types";
import { splitCvObservations } from "./cv-provenance";

/** CV observation safe for the public detail endpoint (no session/frame paths). */
export type PublicCvObservation = Omit<CvObservation, "session_id" | "frame_refs"> & {
  frame_count: number;
};

/** Detail payload merged into SegmentDetail after a segment click. */
export type SegmentMapDetail = {
  community_report: CommunityReport | null;
  community_reports: CommunityReport[];
  cv_observations: PublicCvObservation[];
};

const SCORE_LAYERS: ScoreLayer[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
  "bike",
];

/** Strip privacy-sensitive fields from one CV observation. */
export function scrubCvObservation(o: CvObservation): PublicCvObservation {
  const { session_id: _sid, frame_refs, ...rest } = o;
  void _sid;
  return {
    ...rest,
    frame_count: Array.isArray(frame_refs) ? frame_refs.length : 0,
  };
}

/** Canonical lens scores for paint / popover-summary stubs. */
export function canonicalCvScoreStub(
  observations: CvObservation[],
): Partial<Record<ScoreLayer, number | null>> | undefined {
  const { canonical } = splitCvObservations(observations);
  if (!canonical) return undefined;
  const stub: Partial<Record<ScoreLayer, number | null>> = {};
  for (const layer of SCORE_LAYERS) {
    stub[layer] = canonical.scores[layer] ?? null;
  }
  return stub;
}

/**
 * Reduce a feature to paint-only properties for the public map wire.
 * Drops cv_observations blobs, community report bodies, session_id, frame_refs.
 */
export function toPaintProperties(
  props: SegmentProperties,
  cvObservations?: CvObservation[],
): SegmentProperties {
  const cv = cvObservations ?? props.cv_observations ?? [];
  const cvCount =
    typeof props.cv_count === "number" ? props.cv_count : cv.length;
  const stub = cv.length > 0 ? canonicalCvScoreStub(cv) : undefined;

  const paint: SegmentProperties = {
    id: props.id,
    name: props.name,
    district: props.district,
    score_overall: props.score_overall,
    score_accessibility: props.score_accessibility,
    score_drainage: props.score_drainage,
    score_shade: props.score_shade,
    score_bike: props.score_bike,
    audited_at: props.audited_at,
    demo: props.demo,
  };

  if (props.source !== undefined) paint.source = props.source;
  if (props.verified !== undefined) paint.verified = props.verified;
  if (cvCount > 0) paint.cv_count = cvCount;

  if (stub) {
    if (stub.overall !== null && stub.overall !== undefined) paint.cv_overall = stub.overall;
    if (stub.accessibility !== null && stub.accessibility !== undefined) {
      paint.cv_accessibility = stub.accessibility;
    }
    if (stub.drainage !== null && stub.drainage !== undefined) paint.cv_drainage = stub.drainage;
    if (stub.shade !== null && stub.shade !== undefined) paint.cv_shade = stub.shade;
    if (stub.bike !== null && stub.bike !== undefined) paint.cv_bike = stub.bike;
  }

  return paint;
}

/** Paint-only GeoJSON feature (geometry unchanged). */
export function toPaintFeature(
  feature: SegmentFeature,
  cvBySegment?: Map<string, CvObservation[]>,
): SegmentFeature {
  const cv = cvBySegment?.get(feature.properties.id);
  return {
    ...feature,
    properties: toPaintProperties(feature.properties, cv),
  };
}

/** Scrub a list of CV observations for the public detail response. */
export function scrubCvObservations(observations: CvObservation[]): PublicCvObservation[] {
  return observations.map(scrubCvObservation);
}
