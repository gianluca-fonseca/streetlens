import type { ExpressionSpecification } from "maplibre-gl";
// Type-only import (same discipline as mapConfig): erased at build time, so
// lib/segments' fs usage never reaches the client bundle.
import type { SegmentCollection, SegmentFeature } from "@/lib/segments";

/*
 * Hero score relief — the landing map's 3D signature.
 *
 * Each score-carrying street is expanded into a corridor polygon and extruded
 * to a height driven by `score_overall`: a good street stands, a bad street
 * sits low against the ground. Colour comes from the SAME sealed overall ramp
 * the 2D lines use (mapConfig.lineColorExpression), so the relief is the score
 * encoding gaining a third axis, not a second encoding.
 *
 * Honesty contract: the relief is a CHART, not terrain. Heights are scores in
 * abstract metres, never real elevation or building height, and the landing
 * caption under the plate says so. Only features the 2D score ramp already
 * draws (audited, or camera-observed with canonical scores) are extruded;
 * unaudited community/import segments keep their flat dashed casing. In the
 * real-data era with no published audits every `score_overall` is 0, so the
 * relief collection is simply empty — no invented heights, no orphaned bars.
 *
 * Scope: hero variant only. The /map app surface never adds this source or
 * layer, and nothing here touches the sealed RAMP, the line expressions, or
 * the terrain/building 3D mode (u8).
 */

export const RELIEF_SOURCE_ID = "segments-relief";
export const RELIEF_LAYER_ID = "segments-relief";

/**
 * Corridor half-width in metres. Deliberately wider than a real street: at the
 * hero's settled zoom (~14.3, ≈8 m/px at Escazú's latitude) a true 10 m
 * right-of-way is a single pixel. 11 m half-width renders the corridor ~3 px
 * wide — a legible bar, still unmistakably the street network's geometry.
 */
const CORRIDOR_HALF_WIDTH_M = 11;

/** Sharp-bend miter guard: joins never extend past 2x the half-width. */
const MITER_LIMIT = 2;

/**
 * Height mapping, in abstract chart-metres: score 0 → 8 m (present but sunken
 * against its neighbours), score 100 → 150 m (≈18 px tall at the settled
 * camera). Linear, so relative height reads as relative score.
 */
const RELIEF_HEIGHT_AT_0 = 8;
const RELIEF_HEIGHT_AT_100 = 150;

/** MapLibre fill-extrusion height expression over `score_overall`. */
export const reliefHeightExpression = [
  "+",
  RELIEF_HEIGHT_AT_0,
  ["*", (RELIEF_HEIGHT_AT_100 - RELIEF_HEIGHT_AT_0) / 100, ["get", "score_overall"]],
] as unknown as ExpressionSpecification;

/** Mirrors mapConfig's COMMUNITY_SOURCES routing (kept private there). */
const COMMUNITY_SOURCES = new Set(["community", "import"]);

/**
 * Client-side mirror of RAMP_LAYER_FILTER plus a real-score guard: extrude
 * exactly the features the 2D score ramp draws, and only when they carry a
 * non-zero overall score (a zero-height slab is noise, and in the real-data
 * era zero means "not audited yet", which must not render as data).
 */
function carriesScore(f: SegmentFeature): boolean {
  const p = f.properties;
  if (p.score_overall <= 0) return false;
  if (!COMMUNITY_SOURCES.has(p.source ?? "")) return true;
  return (p.cv_count ?? 0) > 0;
}

type ReliefProperties = { id: string; score_overall: number };
type ReliefFeature = GeoJSON.Feature<GeoJSON.Polygon, ReliefProperties>;
export type ReliefCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon,
  ReliefProperties
>;

/** Metres per degree of latitude (spherical mean; exact is irrelevant at 16 m). */
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQUATOR = 111320;

/**
 * Expand one LineString into a corridor polygon ring with mitered joins.
 * Works in a local planar metre frame anchored at the first coordinate —
 * fine at segment scale (hundreds of metres). Returns null for degenerate
 * geometry (fewer than two distinct points).
 */
function corridorRing(
  coords: [number, number][],
  halfWidthM: number,
): [number, number][] | null {
  const [lng0, lat0] = coords[0];
  const kx = M_PER_DEG_LNG_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const ky = M_PER_DEG_LAT;

  // Project to metres, dropping consecutive duplicates.
  const pts: [number, number][] = [];
  for (const [lng, lat] of coords) {
    const x = (lng - lng0) * kx;
    const y = (lat - lat0) * ky;
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(x - prev[0], y - prev[1]) < 0.01) continue;
    pts.push([x, y]);
  }
  if (pts.length < 2) return null;

  // Unit normal of each segment (left-hand side of travel direction).
  const segNormals: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segNormals.push([-dy / len, dx / len]);
  }

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const nPrev = segNormals[Math.max(0, i - 1)];
    const nNext = segNormals[Math.min(segNormals.length - 1, i)];
    let mx = nPrev[0] + nNext[0];
    let my = nPrev[1] + nNext[1];
    const mLen = Math.hypot(mx, my);
    if (mLen < 1e-9) {
      // 180° reversal: fall back to the incoming segment's normal.
      mx = nPrev[0];
      my = nPrev[1];
    } else {
      mx /= mLen;
      my /= mLen;
    }
    // Miter scale = 1/cos(θ/2), clamped so sharp bends never spike.
    const cosHalf = Math.max(mx * nNext[0] + my * nNext[1], 1 / MITER_LIMIT);
    const d = halfWidthM / cosHalf;
    left.push([pts[i][0] + mx * d, pts[i][1] + my * d]);
    right.push([pts[i][0] - mx * d, pts[i][1] - my * d]);
  }

  const ringM = [...left, ...right.reverse()];
  ringM.push(ringM[0]);
  return ringM.map(([x, y]) => [x / kx + lng0, y / ky + lat0]);
}

/**
 * Build the relief collection from the live segment collection. Pure and
 * synchronous, so the era-flip effect can rebuild it whenever the demo switch
 * swaps the underlying data (the relief must follow the same setData path as
 * the 2D source, or the hero would keep the previous era's heights).
 */
export function buildReliefCollection(
  segments: SegmentCollection,
): ReliefCollection {
  const features: ReliefFeature[] = [];
  for (const f of segments.features) {
    if (!carriesScore(f)) continue;
    const ring = corridorRing(
      f.geometry.coordinates as [number, number][],
      CORRIDOR_HALF_WIDTH_M,
    );
    if (!ring) continue;
    features.push({
      type: "Feature",
      properties: {
        id: f.properties.id,
        score_overall: f.properties.score_overall,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}
