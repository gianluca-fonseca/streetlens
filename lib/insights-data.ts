/**
 * Server loader for the Insights instrument panel.
 *
 * Assembles paint-safe segments, stats, scrubbed walks, and network lengths.
 * Never exposes session_id or frame_refs on the public surface.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildObservationTimeline,
  computeAllLensDistributions,
  computeCoverageProgress,
  computeDistrictRollups,
  indexSegmentsById,
  listWorstCvStreets,
  scrubWalksForTimeline,
  type CoverageProgress,
  type DistrictRollup,
  type LensDistribution,
  type ScrubbedWalk,
  type TimelineEvent,
  type WorstCvStreet,
} from "@/lib/insights";
import { getMunicipality, type MunicipalityConfig } from "@/lib/municipality";
import { readCvObservations } from "@/lib/community-store";
import { getSegments, getStats, type StreetStats } from "@/lib/segments";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllPages } from "@/lib/supabase-bounded";
import type { CvObservation, SegmentCollection } from "@/lib/types";
import { insightSegmentHref } from "@/lib/segment-links";

const NETWORK_SEGMENTS_PATH = path.join(
  process.cwd(),
  "data",
  "segments.geojson",
);

type NetworkLengths = {
  byId: Map<string, number>;
  totalMeters: number;
};

type CvRow = {
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

function rowToCv(row: CvRow): CvObservation {
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

async function liveAllCvObservations(): Promise<CvObservation[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const rows = await fetchAllPages<CvRow>(
      "community_cv_observations insights",
      async (from, to) => {
        const { data, error } = await client
          .from("community_cv_observations")
          .select(
            "id,segment_id,session_id,score_overall,score_accessibility,score_drainage,score_shade,score_bike,item_medians,coverage,confidence,frame_refs,captured_on,submission_id,created_at,human_corrected,overrides,assessment",
          )
          .range(from, to);
        if (error || !data) return null;
        return data as CvRow[];
      },
      { maxRows: 5000 },
    );
    if (!rows) return null;
    return rows.map(rowToCv);
  } catch {
    return null;
  }
}

async function getAllCvObservations(): Promise<CvObservation[]> {
  return (await liveAllCvObservations()) ?? readCvObservations();
}

async function readNetworkLengths(): Promise<NetworkLengths> {
  const byId = new Map<string, number>();
  let totalMeters = 0;
  try {
    const parsed = JSON.parse(
      await fs.readFile(NETWORK_SEGMENTS_PATH, "utf8"),
    ) as {
      features?: Array<{ properties?: { id?: string; length_m?: number } }>;
    };
    for (const f of parsed.features ?? []) {
      const id = f.properties?.id;
      const len = f.properties?.length_m;
      if (typeof id !== "string" || typeof len !== "number" || !(len > 0)) {
        continue;
      }
      byId.set(id, len);
      totalMeters += len;
    }
  } catch {
    // empty → coverage reads 0
  }
  return { byId, totalMeters };
}

export type RankedStreetRow = WorstCvStreet & { href: string };

export type InsightsSnapshot = {
  municipality: MunicipalityConfig;
  stats: StreetStats;
  segments: SegmentCollection;
  districts: DistrictRollup[];
  worstStreets: RankedStreetRow[];
  distributions: LensDistribution[];
  timeline: TimelineEvent[];
  coverage: CoverageProgress;
  walks: ScrubbedWalk[];
};

function attachWalkDates(
  rows: WorstCvStreet[],
  walks: ScrubbedWalk[],
): WorstCvStreet[] {
  const latest = new Map<string, string>();
  for (const w of walks) {
    const prev = latest.get(w.segment_id);
    if (!prev || w.captured_on > prev) latest.set(w.segment_id, w.captured_on);
  }
  return rows.map((r) => ({
    ...r,
    captured_on: latest.get(r.id) ?? r.captured_on,
  }));
}

/** Full public insights snapshot for the ISR page. */
export async function getInsightsSnapshot(): Promise<InsightsSnapshot> {
  const [segments, stats, observations, lengths] = await Promise.all([
    getSegments(),
    getStats(),
    getAllCvObservations(),
    readNetworkLengths(),
  ]);

  const walks = scrubWalksForTimeline(observations);
  const index = indexSegmentsById(segments);
  const worst = attachWalkDates(listWorstCvStreets(segments, { limit: 12 }), walks);

  return {
    municipality: getMunicipality(),
    stats,
    segments,
    districts: computeDistrictRollups(segments, lengths.byId),
    worstStreets: worst.map((r) => ({
      ...r,
      href: insightSegmentHref(r.id, "overall"),
    })),
    distributions: computeAllLensDistributions(segments),
    timeline: buildObservationTimeline(walks, index, 24),
    coverage: computeCoverageProgress(walks, lengths.byId, lengths.totalMeters),
    walks,
  };
}
