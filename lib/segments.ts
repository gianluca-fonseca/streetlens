/**
 * Segment data-access layer — the single source the UI reads through.
 *
 * Exports are a frozen contract shared with the map UI unit:
 *   - `ScoreLayer`, `SCORE_LAYERS`, `SegmentProperties`, `SegmentCollection`,
 *     `SegmentDetail`, `StreetStats`
 *   - `getSegments()`      -> SegmentCollection
 *   - `getSegmentDetail()` -> SegmentDetail | null
 *   - `getStats()`         -> StreetStats { segments, km, coveragePct, heroPct }
 *
 * Each reader tries Supabase first when it is configured, and falls back to the
 * generated static data files on any absence or error. The live database does
 * not exist yet, so in practice the static path serves everything today — and
 * the app never blocks on the DB.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "./supabase";
import {
  readCommunityReports,
  readCommunitySegments,
  readCvObservations,
} from "./community-store";
import {
  LEY_7600_MIN_SCORE,
  SCORE_LAYERS,
  type CommunityReport,
  type CommunitySegment,
  type CvObservation,
  type ScoreLayer,
  type SegmentCollection,
  type SegmentDetail,
  type SegmentFeature,
  type SegmentProperties,
  type StreetStats,
} from "./types";

/*
 * FROZEN EXPORT SURFACE (advisor rev 2/3/4, shared with the map UI unit):
 * ScoreLayer, SCORE_LAYERS, SegmentProperties, SegmentCollection,
 * SegmentDetail, StreetStats, getSegments, getSegmentDetail, getStats.
 * Do not rename or drop any of these.
 */
export { SCORE_LAYERS };
export type {
  ScoreLayer,
  SegmentProperties,
  SegmentFeature,
  SegmentCollection,
  SegmentDetail,
  StreetStats,
};

const DATA_DIR = path.join(process.cwd(), "data");
const DEMO_SEGMENTS_PATH = path.join(DATA_DIR, "demo-segments.geojson");
const DEMO_AUDITS_PATH = path.join(DATA_DIR, "demo-audits.json");
// Unaudited canton network (esc-ce/esc-sr) outside the audited pilot, emitted by
// generate-demo-audits.mjs as source:"import" records. Committed (not the local
// runtime community store), read on the same neutral-casing terms as community.
const IMPORT_SEGMENTS_PATH = path.join(DATA_DIR, "canton-import-segments.json");

/* ------------------------------------------------------------------ *
 * Static file readers (cached per process)
 * ------------------------------------------------------------------ */

const DEFAULT_DISTRICT = "San Antonio";
const DEFAULT_AUDITED_AT = "2026-07-10";

type DemoCollection = SegmentCollection & {
  metadata?: {
    audited_km?: number;
    network_km?: number;
    coverage_pct?: number;
    segment_count?: number;
  };
};

type DemoObservation = {
  item_key: string;
  label_en: string;
  label_es: string;
  layer: ScoreLayer;
  response: number;
  note: string | null;
  photos: { storage_path: string; taken_at: string }[];
};

type DemoAudit = {
  audited_on: string;
  auditor: string;
  rubric_version_id: string;
  highway: string;
  length_m: number;
  scores: Record<ScoreLayer, number>;
  observations: DemoObservation[];
};

type DemoAuditsFile = {
  rubric_version_id: string;
  audits: Record<string, DemoAudit>;
};

let demoCollectionCache: DemoCollection | undefined;
let demoAuditsCache: DemoAuditsFile | undefined;
let importSegmentsCache: CommunitySegment[] | undefined;

/**
 * Guarantee the frozen SegmentProperties shape on a static feature. The
 * generator emits district/audited_at already; this backstops any older data
 * file (e.g. a pre-contract placeholder surviving a merge).
 */
function enrichFeature(feature: SegmentFeature): SegmentFeature {
  const p = feature.properties as Partial<SegmentProperties> &
    Pick<SegmentProperties, "id" | "name">;
  if (typeof p.district === "string" && typeof p.audited_at === "string") {
    return feature;
  }
  return {
    ...feature,
    properties: {
      id: p.id,
      name: p.name,
      district: p.district ?? DEFAULT_DISTRICT,
      score_overall: p.score_overall ?? 0,
      score_accessibility: p.score_accessibility ?? 0,
      score_drainage: p.score_drainage ?? 0,
      score_shade: p.score_shade ?? 0,
      score_bike: p.score_bike ?? 0,
      audited_at: p.audited_at ?? DEFAULT_AUDITED_AT,
      demo: p.demo ?? true,
    },
  };
}

async function readDemoCollection(): Promise<DemoCollection> {
  if (!demoCollectionCache) {
    const parsed = JSON.parse(
      await fs.readFile(DEMO_SEGMENTS_PATH, "utf8"),
    ) as DemoCollection;
    parsed.features = parsed.features.map(enrichFeature);
    demoCollectionCache = parsed;
  }
  return demoCollectionCache;
}

async function readDemoAudits(): Promise<DemoAuditsFile> {
  if (!demoAuditsCache) {
    demoAuditsCache = JSON.parse(
      await fs.readFile(DEMO_AUDITS_PATH, "utf8"),
    ) as DemoAuditsFile;
  }
  return demoAuditsCache;
}

/**
 * The committed unaudited canton network (esc-ce/esc-sr) as source:"import"
 * CommunitySegments. Cached per process; a missing file → no canton overlay.
 * These merge into the read path exactly like the local community store, so the
 * map renders them with the neutral casing and the audited stats never move.
 */
async function readImportSegments(): Promise<CommunitySegment[]> {
  if (!importSegmentsCache) {
    try {
      const parsed = JSON.parse(await fs.readFile(IMPORT_SEGMENTS_PATH, "utf8"));
      importSegmentsCache = Array.isArray(parsed)
        ? (parsed as CommunitySegment[])
        : [];
    } catch {
      importSegmentsCache = [];
    }
  }
  return importSegmentsCache;
}

/** Applied community adds plus the committed canton import overlay. */
async function readAllContributedSegments(): Promise<CommunitySegment[]> {
  const [community, imported] = await Promise.all([
    readCommunitySegments(),
    readImportSegments(),
  ]);
  return [...community, ...imported];
}

/* ------------------------------------------------------------------ *
 * Live (Supabase) readers — best-effort; any failure returns null so
 * the caller falls back to static data.
 * ------------------------------------------------------------------ */

type ScoreRow = {
  id: string;
  name: string;
  district: string;
  highway: string;
  length_m: number;
  demo: boolean;
  audited_at: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  score_bike: number;
};

function rowToFeature(row: ScoreRow): SegmentFeature {
  return {
    type: "Feature",
    properties: {
      id: row.id,
      name: row.name,
      district: row.district,
      score_overall: row.score_overall,
      score_accessibility: row.score_accessibility,
      score_drainage: row.score_drainage,
      score_shade: row.score_shade,
      score_bike: row.score_bike,
      audited_at: row.audited_at,
      demo: row.demo,
    },
    geometry: row.geometry,
  };
}

async function liveScoreRows(id?: string): Promise<ScoreRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    let query = client
      .from("v_segment_scores")
      .select(
        "id,name,district,highway,length_m,demo,audited_at,geometry,score_overall,score_accessibility,score_drainage,score_shade,score_bike",
      );
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error || !data) return null;
    return data as ScoreRow[];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Community layer (contract v3, u7) — applied contributions merged into the
 * read path. Community/import segments carry NO rubric scores; they render with
 * the neutral community casing and are excluded from the official stats.
 *
 * u30 adds a third record kind on identical terms: approved CV observations are
 * ATTACHED to whatever feature they describe (audited or community) and are never
 * folded into any score_* field. An audited segment with a camera pass over it
 * keeps its audited scores exactly; it just also carries what the camera thought.
 * ------------------------------------------------------------------ */

/** Group rows carrying a `segment_id` by that id. */
function groupBySegment<T extends { segment_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const byId = new Map<string, T[]>();
  for (const r of rows) {
    const list = byId.get(r.segment_id);
    if (list) list.push(r);
    else byId.set(r.segment_id, [r]);
  }
  return byId;
}

/** A community segment as a scoreless GeoJSON feature flagged for the map. */
function communitySegmentToFeature(
  cs: CommunitySegment,
  reportsBySegment: Map<string, CommunityReport[]>,
  cvBySegment: Map<string, CvObservation[]>,
): SegmentFeature {
  return {
    type: "Feature",
    properties: {
      id: cs.id,
      name: cs.name,
      district: cs.district,
      score_overall: 0,
      score_accessibility: 0,
      score_drainage: 0,
      score_shade: 0,
      score_bike: 0,
      audited_at: "",
      demo: false,
      source: cs.source,
      verified: cs.verified,
      community_report: cs.community_report,
      community_reports: reportsBySegment.get(cs.id) ?? [],
      cv_observations: cvBySegment.get(cs.id) ?? [],
    },
    geometry: { type: "LineString", coordinates: cs.coordinates },
  };
}

/**
 * Attach community reports and CV observations targeting an official (audited)
 * feature, without mutating the shared cached feature objects.
 *
 * Copy-on-write is load-bearing: `features` may be the module-level
 * demoCollectionCache, and mutating it would leak one request's community data
 * into every later one.
 */
function attachCommunity(
  features: SegmentFeature[],
  reportsBySegment: Map<string, CommunityReport[]>,
  cvBySegment: Map<string, CvObservation[]>,
): SegmentFeature[] {
  return features.map((f) => {
    const reports = reportsBySegment.get(f.properties.id);
    const cv = cvBySegment.get(f.properties.id);
    const hasReports = reports && reports.length > 0;
    const hasCv = cv && cv.length > 0;
    if (!hasReports && !hasCv) return f;
    return {
      ...f,
      properties: {
        ...f.properties,
        ...(hasReports ? { community_reports: reports } : {}),
        ...(hasCv ? { cv_observations: cv } : {}),
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Public API (frozen contract)
 * ------------------------------------------------------------------ */

/**
 * All segments as a GeoJSON collection for the map: the audited reference set
 * plus any applied community/import segments (flagged `source`/`verified`, no
 * scores). Community reports are attached to their target features.
 */
export async function getSegments(): Promise<SegmentCollection> {
  const [community, reports, cvObservations] = await Promise.all([
    readAllContributedSegments(),
    readCommunityReports(),
    readCvObservations(),
  ]);
  const reportsBySegment = groupBySegment(reports);
  const cvBySegment = groupBySegment(cvObservations);
  const communityFeatures = community.map((cs) =>
    communitySegmentToFeature(cs, reportsBySegment, cvBySegment),
  );

  const live = await liveScoreRows();
  const officialFeatures =
    live && live.length > 0
      ? live.map(rowToFeature)
      : (await readDemoCollection()).features;

  return {
    type: "FeatureCollection",
    features: [
      ...attachCommunity(officialFeatures, reportsBySegment, cvBySegment),
      ...communityFeatures,
    ],
  };
}

/** Full detail for one segment, or null if unknown. */
export async function getSegmentDetail(
  id: string,
): Promise<SegmentDetail | null> {
  const live = await liveScoreRows(id);
  if (live && live.length > 0) {
    const row = live[0];
    return {
      id: row.id,
      name: row.name,
      district: row.district,
      audited_at: row.audited_at,
      highway: row.highway,
      length_m: row.length_m,
      demo: row.demo,
      geometry: row.geometry,
      scores: {
        overall: row.score_overall,
        accessibility: row.score_accessibility,
        drainage: row.score_drainage,
        shade: row.score_shade,
        bike: row.score_bike,
      },
      // Observation-level detail comes from a dedicated query in a later unit;
      // the map needs scores + geometry here.
      audit: null,
    };
  }

  // Static fallback: join geometry from the collection with the audit detail.
  const [collection, audits] = await Promise.all([
    readDemoCollection(),
    readDemoAudits(),
  ]);
  const feature = collection.features.find((f) => f.properties.id === id);
  if (!feature) {
    // A community/import segment carries geometry but no rubric audit.
    const community = await readAllContributedSegments();
    const cs = community.find((c) => c.id === id);
    if (!cs) return null;
    return {
      id: cs.id,
      name: cs.name,
      district: cs.district,
      audited_at: "",
      highway: cs.highway,
      length_m: 0,
      demo: false,
      geometry: { type: "LineString", coordinates: cs.coordinates },
      scores: { overall: 0, accessibility: 0, drainage: 0, shade: 0, bike: 0 },
      audit: null,
    };
  }
  const audit = audits.audits[id];

  return {
    id,
    name: feature.properties.name,
    district: feature.properties.district,
    audited_at: feature.properties.audited_at,
    highway: audit?.highway ?? "unknown",
    length_m: audit?.length_m ?? 0,
    demo: feature.properties.demo,
    geometry: feature.geometry,
    scores: {
      overall: feature.properties.score_overall,
      accessibility: feature.properties.score_accessibility,
      drainage: feature.properties.score_drainage,
      shade: feature.properties.score_shade,
      bike: feature.properties.score_bike,
    },
    audit: audit
      ? {
          audited_on: audit.audited_on,
          auditor: audit.auditor,
          rubric_version_id: audit.rubric_version_id,
          observations: audit.observations,
        }
      : null,
  };
}

/** Headline aggregate stats for the hero panel. */
export async function getStats(): Promise<StreetStats> {
  const demo = await readDemoCollection();
  const networkKm = demo.metadata?.network_km;
  // Community/import segments are counted separately; never folded into the
  // official audited figure (contract v3, ruling 1). Same for CV (u30). This is
  // the CONTRIBUTION counter (the apply pipeline's community adds); the committed
  // canton network overlay is baseline context, not a contribution, so it is not
  // tallied here (and, like community adds, never touches the audited figure).
  const communitySegments = (await readCommunitySegments()).length;
  const cv = await readCvObservations();
  const cvSessionsReviewed = new Set(cv.map((o) => o.session_id)).size;
  const cvSegments = new Set(cv.map((o) => o.segment_id)).size;

  const live = await liveScoreRows();
  if (live && live.length > 0) {
    const km = live.reduce((sum, r) => sum + (r.length_m ?? 0), 0) / 1000;
    const failing = live.filter(
      (r) => r.score_accessibility < LEY_7600_MIN_SCORE,
    ).length;
    return {
      segments: live.length,
      km: Number(km.toFixed(1)),
      coveragePct:
        networkKm && networkKm > 0
          ? Number(((km / networkKm) * 100).toFixed(1))
          : 100,
      heroPct: Math.round((failing / live.length) * 100),
      communitySegments,
      cvSessionsReviewed,
      cvSegments,
    };
  }

  // Static fallback: import-time facts from metadata + a hero derived live.
  const features = demo.features;
  const failing = features.filter(
    (f) => f.properties.score_accessibility < LEY_7600_MIN_SCORE,
  ).length;
  return {
    segments: demo.metadata?.segment_count ?? features.length,
    km: demo.metadata?.audited_km ?? 0,
    coveragePct: demo.metadata?.coverage_pct ?? 100,
    heroPct: features.length
      ? Math.round((failing / features.length) * 100)
      : 0,
    communitySegments,
    cvSessionsReviewed,
    cvSegments,
  };
}
