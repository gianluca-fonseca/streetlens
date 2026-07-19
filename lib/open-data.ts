/**
 * Public open-data pack — scrubbed GeoJSON + CSV for researchers / GIS teams.
 *
 * Privacy contract matches the paint payload (bgsd-0011):
 * - no session_id, frame_refs, contacts, or community report bodies
 * - geometry + lens scores + provenance stubs only
 *
 * Bounded: only segments with published evidence (camera observation and/or
 * field audit), capped at OPEN_DATA_MAX_FEATURES.
 */

import { canonicalCvObservation } from "./cv-provenance";
import { MUNICIPALITY } from "./municipality";
import type { CvObservation, SegmentCollection, SegmentFeature } from "./types";

/** Hard ceiling so a full-canton dump cannot unbounded-response a client. */
export const OPEN_DATA_MAX_FEATURES = 2000;

export const OPEN_DATA_LICENSE = {
  geometry: "ODbL 1.0 (OpenStreetMap)",
  scores: "CC BY 4.0 (StreetLens)",
  note: "Camera-observed scores are provisional until a field audit is published.",
} as const;

/** Flat row shape for CSV + GeoJSON properties. */
export type OpenDataRow = {
  id: string;
  name: string;
  district: string;
  length_m: number | null;
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  score_bike: number;
  cv_overall: number | null;
  cv_accessibility: number | null;
  cv_drainage: number | null;
  cv_shade: number | null;
  cv_bike: number | null;
  source: string;
  cv_count: number;
  captured_on: string | null;
  rubric_version: string;
  audited_at: string;
};

export const OPEN_DATA_CSV_COLUMNS: readonly (keyof OpenDataRow)[] = [
  "id",
  "name",
  "district",
  "length_m",
  "score_overall",
  "score_accessibility",
  "score_drainage",
  "score_shade",
  "score_bike",
  "cv_overall",
  "cv_accessibility",
  "cv_drainage",
  "cv_shade",
  "cv_bike",
  "source",
  "cv_count",
  "captured_on",
  "rubric_version",
  "audited_at",
] as const;

/** Forbidden keys that must never appear on the open-data wire. */
export const OPEN_DATA_FORBIDDEN_KEYS = [
  "session_id",
  "frame_refs",
  "contact",
  "community_report",
  "community_reports",
  "cv_observations",
] as const;

function hasPublishedEvidence(f: SegmentFeature): boolean {
  const p = f.properties;
  if ((p.cv_count ?? 0) > 0) return true;
  if (p.source === "import" || p.source === "community") return false;
  return Boolean(p.audited_at) && p.score_overall > 0;
}

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build scrubbed open-data rows from a paint FeatureCollection + length/CV maps.
 * Pure — callers supply already-scrubbed paint features (from getSegments).
 */
export function buildOpenDataRows(
  collection: SegmentCollection,
  lengthsById: Map<string, number>,
  cvBySegment: Map<string, CvObservation[]>,
  maxFeatures = OPEN_DATA_MAX_FEATURES,
): OpenDataRow[] {
  const rows: OpenDataRow[] = [];
  for (const f of collection.features) {
    if (!hasPublishedEvidence(f)) continue;
    const p = f.properties;
    const cvList = cvBySegment.get(p.id) ?? [];
    const canonical = canonicalCvObservation(cvList);
    rows.push({
      id: p.id,
      name: p.name,
      district: p.district,
      length_m: lengthsById.get(p.id) ?? null,
      score_overall: p.score_overall,
      score_accessibility: p.score_accessibility,
      score_drainage: p.score_drainage,
      score_shade: p.score_shade,
      score_bike: p.score_bike,
      cv_overall: p.cv_overall ?? null,
      cv_accessibility: p.cv_accessibility ?? null,
      cv_drainage: p.cv_drainage ?? null,
      cv_shade: p.cv_shade ?? null,
      cv_bike: p.cv_bike ?? null,
      source: p.source ?? (p.audited_at ? "audit" : "unknown"),
      cv_count: p.cv_count ?? 0,
      captured_on: canonical?.captured_on ?? null,
      rubric_version: MUNICIPALITY.rubricVersion,
      audited_at: p.audited_at ?? "",
    });
    if (rows.length >= maxFeatures) break;
  }
  return rows;
}

/** Scrubbed GeoJSON FeatureCollection for the open-data endpoint. */
export function buildOpenDataGeoJson(
  collection: SegmentCollection,
  lengthsById: Map<string, number>,
  cvBySegment: Map<string, CvObservation[]>,
  maxFeatures = OPEN_DATA_MAX_FEATURES,
): {
  type: "FeatureCollection";
  metadata: {
    license: typeof OPEN_DATA_LICENSE;
    municipality: string;
    generated_at: string;
    feature_count: number;
    bounded: true;
    max_features: number;
  };
  features: Array<{
    type: "Feature";
    properties: OpenDataRow;
    geometry: SegmentFeature["geometry"];
  }>;
} {
  const rows = buildOpenDataRows(collection, lengthsById, cvBySegment, maxFeatures);
  const byId = new Map(collection.features.map((f) => [f.properties.id, f]));
  const features = rows
    .map((row) => {
      const f = byId.get(row.id);
      if (!f) return null;
      return {
        type: "Feature" as const,
        properties: row,
        geometry: f.geometry,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  return {
    type: "FeatureCollection",
    metadata: {
      license: OPEN_DATA_LICENSE,
      municipality: MUNICIPALITY.name,
      generated_at: new Date().toISOString(),
      feature_count: features.length,
      bounded: true,
      max_features: maxFeatures,
    },
    features,
  };
}

/** CSV document (header + rows) for the open-data endpoint. */
export function buildOpenDataCsv(
  collection: SegmentCollection,
  lengthsById: Map<string, number>,
  cvBySegment: Map<string, CvObservation[]>,
  maxFeatures = OPEN_DATA_MAX_FEATURES,
): string {
  const rows = buildOpenDataRows(collection, lengthsById, cvBySegment, maxFeatures);
  const header = OPEN_DATA_CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    OPEN_DATA_CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","),
  );
  return [header, ...lines].join("\n") + (lines.length ? "\n" : "");
}

/** Assert a properties object has no forbidden privacy keys. */
export function assertOpenDataScrubbed(props: Record<string, unknown>): boolean {
  return OPEN_DATA_FORBIDDEN_KEYS.every((k) => !(k in props));
}
