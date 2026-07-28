/**
 * Street report card data — the shareable civic artifact for one segment.
 */

import {
  cvOverallAssessment,
  formatProvenanceDate,
  splitCvObservations,
} from "@/lib/cv-provenance";
import type { PublicCvObservation } from "@/lib/map-payload";
import { showDemoData } from "@/lib/demo-flag";
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
  /**
   * The five rubric figures. Meaningless unless `hasAudit` is true: an
   * unaudited segment carries structural zeros, never measurements. Read
   * `hasAudit` first, always.
   */
  scores: Record<ScoreLayer, number>;
  /**
   * Whether a rubric audit actually stands behind `scores`. False in the
   * real-data era, and false for a community or camera-only street in any era.
   * The single guard against printing `0%` as though it were a measured
   * failure.
   */
  hasAudit: boolean;
  provenance: StreetProvenanceLine[];
  assessment: string | null;
};

/**
 * Whether a rubric audit backs this segment's scores.
 *
 * The audit block is the direct evidence, and a live Supabase row can carry
 * scores with the observation detail fetched separately, so a positive figure
 * counts too. Camera observations and community reports deliberately do NOT:
 * they are real provenance, and they get their own sections on the card, but
 * neither one produces a rubric score, so neither one may unlock the score grid.
 */
function hasAuditedScores(
  segment: NonNullable<Awaited<ReturnType<typeof getSegmentDetail>>>,
): boolean {
  if (segment.audit) return true;
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

/**
 * Full street card payload, or null when the segment id is unknown.
 *
 * A street with nothing measured is still a street: it keeps its name, its
 * district and its geometry, and the card says plainly that no field audit
 * stands behind it yet. Only an id that resolves to no segment at all is a 404.
 *
 * @param demoEnabled The effective demo-data flag, resolved per request by the
 * page with `demoDataEnabled()`. Defaults to the build-time default so the
 * shared, CDN-cached surfaces (the OG image) never vary on one browser's cookie.
 */
export async function getStreetCard(
  segmentId: string,
  locale: string,
  demoEnabled: boolean = showDemoData(),
): Promise<StreetCardData | null> {
  const segment = await getSegmentDetail(segmentId, demoEnabled);
  if (!segment) return null;

  const detail = await getSegmentMapDetail(segmentId);
  const reports = [
    ...(detail.community_report ? [detail.community_report] : []),
    ...detail.community_reports,
  ];
  const { canonical } = splitCvObservations(detail.cv_observations);

  return {
    id: segment.id,
    name: segment.name,
    district: segment.district,
    demo: segment.demo,
    geometry: segment.geometry,
    scores: segment.scores,
    hasAudit: hasAuditedScores(segment),
    provenance: provenanceLines(segment, canonical, reports, locale),
    assessment: canonical ? cvOverallAssessment(canonical.assessment) : null,
  };
}
