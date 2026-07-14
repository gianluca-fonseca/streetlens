import { promises as fs } from "fs";
import path from "path";
import type { Feature, FeatureCollection, LineString } from "geojson";

/*
 * FROZEN DATA CONTRACT — u1-design-map.
 *
 * This is a THIN static-GeoJSON adapter. u2-data-layer OWNS the internals and
 * will replace them (Supabase + fallback). A merge conflict on this file is
 * EXPECTED and planned: u2 must match the exact export surface below
 * (types + function signatures). Do not rename these exports.
 *
 * The UI consumes data ONLY through this module.
 */

export type ScoreLayer = "overall" | "accessibility" | "drainage" | "shade";

export const SCORE_LAYERS: readonly ScoreLayer[] = [
  "overall",
  "accessibility",
  "drainage",
  "shade",
] as const;

/** Property key on a segment feature that holds a given layer's 0–100 score. */
export function scoreKey(layer: ScoreLayer): `score_${ScoreLayer}` {
  return `score_${layer}` as const;
}

/** Feature properties exposed to the UI (flat 0–100 scores, MapLibre-friendly). */
export type SegmentProperties = {
  id: string;
  name: string;
  district: string;
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  audited_at: string;
  demo: boolean;
};

export type SegmentFeature = Feature<LineString, SegmentProperties>;
export type SegmentCollection = FeatureCollection<LineString, SegmentProperties>;

/** One rubric line item inside a layer breakdown (placeholder structure). */
export type BreakdownItem = {
  label: string;
  score: number;
};

export type LayerBreakdown = {
  layer: ScoreLayer;
  score: number;
  items: BreakdownItem[];
};

export type SegmentDetail = {
  id: string;
  name: string;
  district: string;
  audited_at: string;
  demo: boolean;
  scores: Record<ScoreLayer, number>;
  breakdown: LayerBreakdown[];
  /** Photo placeholder slots (real Storage URLs land in a later phase). */
  photos: { id: string; caption: string | null }[];
};

export type StreetStats = {
  segments: number;
  km: number;
  coveragePct: number;
  heroPct: number;
};

// --- internals (u2 replaces everything below this line) ---------------------

type RawSegmentProperties = {
  id: string;
  name: string;
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  demo?: boolean;
};

type RawCollection = FeatureCollection<LineString, RawSegmentProperties>;

const DEMO_AUDITED_AT = "2026-07-01";
/** Ley 7600 accessibility minimum used for the hero "% failing" figure. */
const LEY_7600_MIN = 50;

async function readRaw(): Promise<RawCollection> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "demo-segments.geojson"),
    "utf8",
  );
  return JSON.parse(raw) as RawCollection;
}

/** Derive a district label from the segment name (source has no district column). */
function districtOf(name: string): string {
  if (/san antonio/i.test(name)) return "San Antonio";
  return "Escazú Centro";
}

function enrich(feature: Feature<LineString, RawSegmentProperties>): SegmentFeature {
  const p = feature.properties;
  return {
    ...feature,
    properties: {
      id: p.id,
      name: p.name,
      district: districtOf(p.name),
      score_overall: p.score_overall,
      score_accessibility: p.score_accessibility,
      score_drainage: p.score_drainage,
      score_shade: p.score_shade,
      audited_at: DEMO_AUDITED_AT,
      demo: p.demo ?? true,
    },
  };
}

function haversineKm(a: number[], b: number[]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lengthKm(line: LineString): number {
  const c = line.coordinates;
  let km = 0;
  for (let i = 1; i < c.length; i++) km += haversineKm(c[i - 1], c[i]);
  return km;
}

/** Deterministic per-item placeholder scores clustered around a layer score. */
function placeholderItems(
  layer: ScoreLayer,
  score: number,
  seed: number,
): BreakdownItem[] {
  const labelKeys: Record<ScoreLayer, string[]> = {
    overall: ["surface", "width", "obstruction"],
    accessibility: ["ramp", "tactile", "crossing"],
    drainage: ["grate", "slope", "ponding"],
    shade: ["canopy", "awning", "exposure"],
  };
  return labelKeys[layer].map((key, i) => {
    const jitter = ((seed + i * 37) % 21) - 10; // -10..+10, deterministic
    const value = Math.max(0, Math.min(100, Math.round(score + jitter)));
    return { label: `${layer}.${key}`, score: value };
  });
}

export async function getSegments(): Promise<SegmentCollection> {
  const raw = await readRaw();
  return {
    type: "FeatureCollection",
    features: raw.features.map(enrich),
  };
}

export async function getSegmentDetail(
  id: string,
): Promise<SegmentDetail | null> {
  const raw = await readRaw();
  const found = raw.features.find((f) => f.properties.id === id);
  if (!found) return null;
  const { properties: p } = enrich(found);
  const scores: Record<ScoreLayer, number> = {
    overall: p.score_overall,
    accessibility: p.score_accessibility,
    drainage: p.score_drainage,
    shade: p.score_shade,
  };
  const seed = id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return {
    id: p.id,
    name: p.name,
    district: p.district,
    audited_at: p.audited_at,
    demo: p.demo,
    scores,
    breakdown: SCORE_LAYERS.map((layer) => ({
      layer,
      score: scores[layer],
      items: placeholderItems(layer, scores[layer], seed),
    })),
    photos: [
      { id: `${id}-photo-1`, caption: null },
      { id: `${id}-photo-2`, caption: null },
      { id: `${id}-photo-3`, caption: null },
    ],
  };
}

export async function getStats(): Promise<StreetStats> {
  const raw = await readRaw();
  const features = raw.features;
  const segments = features.length;
  const km = features.reduce((sum, f) => sum + lengthKm(f.geometry), 0);
  const failing = features.filter(
    (f) => f.properties.score_accessibility < LEY_7600_MIN,
  ).length;
  const heroPct = segments === 0 ? 0 : Math.round((failing / segments) * 100);
  // Demo coverage: audited segments as a share of the pilot corridor target (30).
  const coveragePct = Math.min(100, Math.round((segments / 30) * 100));
  return {
    segments,
    km: Math.round(km * 10) / 10,
    coveragePct,
    heroPct,
  };
}
