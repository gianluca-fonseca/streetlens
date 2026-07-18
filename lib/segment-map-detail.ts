/**
 * Click-time segment detail for the public map panel — community reports and
 * scrubbed CV observations for one segment id.
 */

import { getSupabaseClient } from "./supabase";
import {
  readCommunityReports,
  readCommunitySegments,
  readCvObservations,
} from "./community-store";
import { scrubCvObservations, type SegmentMapDetail } from "./map-payload";
import { fetchAllPages } from "./supabase-bounded";
import type { CommunityReport, CvObservation } from "./types";

const MAX_CV_OBSERVATIONS_PER_SEGMENT = 50;
const MAX_REPORTS_PER_SEGMENT = 50;

type CvObservationRow = {
  id: string;
  segment_id: string;
  session_id: string;
  score_overall: number | string | null;
  score_accessibility: number | string | null;
  score_drainage: number | string | null;
  score_shade: number | string | null;
  score_bike: number | string | null;
  item_medians: CvObservation["item_medians"] | null;
  coverage: number | string | null;
  confidence: number | string | null;
  frame_refs: string[] | null;
  captured_on: string | null;
  submission_id: string | null;
  created_at: string;
  human_corrected: boolean | null;
  overrides: Record<string, unknown> | null;
  assessment: CvObservation["assessment"] | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToCvObservation(row: CvObservationRow): CvObservation {
  return {
    id: row.id,
    segment_id: row.segment_id,
    session_id: row.session_id,
    scores: {
      overall: toNum(row.score_overall),
      accessibility: toNum(row.score_accessibility),
      drainage: toNum(row.score_drainage),
      shade: toNum(row.score_shade),
      bike: toNum(row.score_bike),
    },
    item_medians: row.item_medians ?? {},
    confidence: toNum(row.confidence),
    coverage: toNum(row.coverage) ?? 0,
    frame_refs: Array.isArray(row.frame_refs) ? row.frame_refs : [],
    captured_on: row.captured_on ?? row.created_at,
    source: "cv",
    submission_id: row.submission_id,
    created_at: row.created_at,
    human_corrected: row.human_corrected ?? false,
    overrides: row.overrides ?? {},
    assessment: row.assessment ?? null,
  };
}

async function liveCvObservationsForSegment(
  segmentId: string,
): Promise<CvObservation[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const rows = await fetchAllPages<CvObservationRow>(
      `community_cv_observations segment=${segmentId}`,
      async (from, to) => {
        const { data, error } = await client
          .from("community_cv_observations")
          .select(
            "id,segment_id,session_id,score_overall,score_accessibility,score_drainage,score_shade,score_bike,item_medians,coverage,confidence,frame_refs,captured_on,submission_id,created_at,human_corrected,overrides,assessment",
          )
          .eq("segment_id", segmentId)
          .order("created_at", { ascending: false })
          .range(from, to);
        if (error || !data) return null;
        return data as CvObservationRow[];
      },
      { maxRows: MAX_CV_OBSERVATIONS_PER_SEGMENT },
    );
    if (!rows) return null;
    return rows.map(rowToCvObservation);
  } catch {
    return null;
  }
}

async function getCvObservationsForSegment(segmentId: string): Promise<CvObservation[]> {
  const live = await liveCvObservationsForSegment(segmentId);
  if (live) return live;
  const all = await readCvObservations();
  return all
    .filter((o) => o.segment_id === segmentId)
    .slice(0, MAX_CV_OBSERVATIONS_PER_SEGMENT);
}

async function getReportsForSegment(segmentId: string): Promise<CommunityReport[]> {
  const all = await readCommunityReports();
  return all
    .filter((r) => r.segment_id === segmentId)
    .slice(0, MAX_REPORTS_PER_SEGMENT);
}

/**
 * Community report embedded on an add_segment feature, if any.
 */
async function getEmbeddedCommunityReport(
  segmentId: string,
): Promise<CommunityReport | null> {
  const segments = await readCommunitySegments();
  const cs = segments.find((s) => s.id === segmentId);
  return cs?.community_report ?? null;
}

/** Full panel detail for one segment (scrubbed for the public wire). */
export async function getSegmentMapDetail(
  segmentId: string,
): Promise<SegmentMapDetail> {
  const [reports, cv, embedded] = await Promise.all([
    getReportsForSegment(segmentId),
    getCvObservationsForSegment(segmentId),
    getEmbeddedCommunityReport(segmentId),
  ]);

  return {
    community_report: embedded,
    community_reports: reports,
    cv_observations: scrubCvObservations(cv),
  };
}
