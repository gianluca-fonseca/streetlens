/**
 * Street report card data — the shareable civic artifact for one segment.
 */

import {
  cvOverallAssessment,
  formatProvenanceDate,
  splitCvObservations,
} from "@/lib/cv-provenance";
import type { PublicCvObservation } from "@/lib/map-payload";
import { getSegmentMapDetail } from "@/lib/segment-map-detail";
import { getSegmentDetail } from "@/lib/segments";
import type { CommunityReport, ScoreLayer } from "@/lib/types";
import type { LineString } from "geojson";

export type StreetProvenanceKind = "audited" | "camera" | "community";

export type StreetProvenanceLine = {
  kind: StreetProvenanceKind;
  primary: string;
  secondary?: string;
};

export type StreetCardData = {
  id: string;
  name: string;
  district: string;
  demo: boolean;
  geometry: LineString;
  scores: Record<ScoreLayer, number>;
  provenance: StreetProvenanceLine[];
  assessment: string | null;
};

function hasMeasurableData(
  segment: NonNullable<Awaited<ReturnType<typeof getSegmentDetail>>>,
  cv: PublicCvObservation[],
  reports: CommunityReport[],
  embedded: CommunityReport | null,
): boolean {
  if (segment.audit) return true;
  if (cv.length > 0) return true;
  if (reports.length > 0 || embedded) return true;
  const { overall, accessibility, drainage, shade, bike } = segment.scores;
  return [overall, accessibility, drainage, shade, bike].some(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
}

function provenanceLines(
  segment: NonNullable<Awaited<ReturnType<typeof getSegmentDetail>>>,
  canonical: PublicCvObservation | null,
  reports: CommunityReport[],
  locale: string,
): StreetProvenanceLine[] {
  const lines: StreetProvenanceLine[] = [];

  if (segment.audit) {
    const date =
      formatProvenanceDate(segment.audit.audited_on, locale) ??
      segment.audited_at ??
      null;
    lines.push({
      kind: "audited",
      primary: date ?? segment.audit.audited_on,
    });
  }

  if (canonical) {
    const walked = formatProvenanceDate(canonical.captured_on, locale);
    const updated = formatProvenanceDate(canonical.created_at, locale);
    lines.push({
      kind: "camera",
      primary: walked ?? canonical.captured_on,
      secondary: updated && updated !== walked ? updated : undefined,
    });
  }

  if (reports.length > 0) {
    const latest = reports[0];
    const date = formatProvenanceDate(latest.created_at, locale);
    lines.push({
      kind: "community",
      primary: date ?? latest.created_at,
    });
  }

  return lines;
}

/** Full street card payload, or null when the segment is unknown or empty. */
export async function getStreetCard(
  segmentId: string,
  locale: string,
): Promise<StreetCardData | null> {
  const segment = await getSegmentDetail(segmentId);
  if (!segment) return null;

  const detail = await getSegmentMapDetail(segmentId);
  const reports = [
    ...(detail.community_report ? [detail.community_report] : []),
    ...detail.community_reports,
  ];
  const { canonical } = splitCvObservations(detail.cv_observations);

  if (!hasMeasurableData(segment, detail.cv_observations, detail.community_reports, detail.community_report)) {
    return null;
  }

  return {
    id: segment.id,
    name: segment.name,
    district: segment.district,
    demo: segment.demo,
    geometry: segment.geometry,
    scores: segment.scores,
    provenance: provenanceLines(segment, canonical, reports, locale),
    assessment: canonical ? cvOverallAssessment(canonical.assessment) : null,
  };
}
