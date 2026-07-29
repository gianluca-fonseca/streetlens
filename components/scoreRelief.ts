import type { ExpressionSpecification } from "maplibre-gl";
// Type-only import (same discipline as mapConfig): erased at build time, so
// lib/segments' fs usage never reaches the client bundle.
import type {
  ScoreLayer,
  SegmentCollection,
  SegmentFeature,
} from "@/lib/segments";

/*
 * Score relief — the network's third axis, on the landing hero AND on `/map`.
 *
 * Each score-carrying street is expanded into a corridor polygon and extruded
 * to a height driven by `score_overall`: a good street stands, a bad street
 * sits low against the ground. Colour comes from the SAME overall ramp the 2D
 * lines use (mapConfig.lineColorExpression, on the same basemap half), so the
 * relief is the score encoding gaining a third axis, not a second encoding.
 *
 * Height obeys mapConfig's direction rule — MORE PRESENCE MEANS A BETTER SCORE —
 * which is now also what colour and line width say. Rev 7 had width running the
 * opposite way; the two channels agreeing is the point, so if the height mapping
 * below is ever inverted, WIDTH_AT_0/WIDTH_AT_100 in mapConfig and the `relief`
 * caption in messages/en.json + messages/es.json have to invert with it.
 *
 * Honesty contract: the relief is a CHART, not terrain. Heights are scores in
 * abstract metres, never real elevation or building height, and the landing
 * caption under the plate says so. Only features the 2D score ramp already
 * draws (audited, or camera-observed with canonical scores) are extruded;
 * unaudited community/import segments keep their flat dashed casing. In the
 * real-data era with no published audits every `score_overall` is 0, so the
 * relief collection is simply empty. No invented heights, no orphaned bars, and
 * on `/map` with the demo data off that empty stage is the honest reading: the
 * flat plan is still drawn underneath, there is simply nothing scored to stand
 * up yet.
 *
 * Scope: this file builds geometry and nothing else. It is shared verbatim by
 * the landing hero and the `/map` instrument (they differ only in camera and in
 * whether the volumes are clickable), and nothing here touches the sealed RAMP
 * or the line expressions.
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

/**
 * MapLibre fill-extrusion height expression for a lens.
 *
 * Both dimensional channels follow the SAME lens, which is the only coherent
 * answer once `/map`'s lens switcher can drive the relief: a volume painted
 * from the drainage ramp but sized by the overall score would be showing the
 * reader two different numbers on one mark. On the hero this is always
 * `overall`, since the hero never switches lenses.
 */
export function reliefHeightExpression(
  layer: ScoreLayer = "overall",
): ExpressionSpecification {
  return [
    "+",
    RELIEF_HEIGHT_AT_0,
    [
      "*",
      (RELIEF_HEIGHT_AT_100 - RELIEF_HEIGHT_AT_0) / 100,
      ["get", `score_${layer}`],
    ],
  ] as unknown as ExpressionSpecification;
}

/** Mirrors mapConfig's COMMUNITY_SOURCES routing (kept private there). */
const COMMUNITY_SOURCES = new Set(["community", "import"]);

/**
 * Client-side mirror of RAMP_LAYER_FILTER plus a real-score guard: extrude
 * exactly the features the 2D score ramp draws, and only when they carry a
 * non-zero overall score (a zero-height slab is noise, and in the real-data
 * era zero means "not audited yet", which must not render as data).
 *
 * `score_overall` remains the gate even though the relief can now be drawn on
 * any lens, because the question it answers is "has this street been audited at
 * all", not "how does it do on drainage". A street audited into a genuine 0 on
 * one lens is data and stands as a low slab; a street with no audit is absent.
 */
function carriesScore(f: SegmentFeature): boolean {
  const p = f.properties;
  if (p.score_overall <= 0) return false;
  if (!COMMUNITY_SOURCES.has(p.source ?? "")) return true;
  return (p.cv_count ?? 0) > 0;
}

/** Every lens's score travels with the volume, so switching the lens is a
 *  repaint rather than a rebuild of the whole corridor collection. */
const SCORE_KEYS = [
  "score_overall",
  "score_accessibility",
  "score_drainage",
  "score_shade",
  "score_bike",
] as const;

type ReliefProperties = { id: string } & Record<
  (typeof SCORE_KEYS)[number],
  number
>;
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
    const properties = { id: f.properties.id } as ReliefProperties;
    for (const key of SCORE_KEYS) properties[key] = f.properties[key] ?? 0;
    features.push({
      type: "Feature",
      // `promoteId: "id"` on the source lifts this into the feature id, so a
      // segment's hover and selected state addresses its volume and its line
      // with one call. The property is kept as well: MapLibre hands the
      // promoted id back on `feature.id`, but the click handler resolves the
      // full segment from the collection by property and should not depend on
      // which of the two the hit came through.
      id: f.properties.id,
      properties,
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}
