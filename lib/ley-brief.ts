/**
 * Ley 7600 compliance brief aggregations — pure, testable.
 *
 * Uses accessibility scores already on the public paint wire. Camera-observed
 * segments carry provisional CV scores; field audits win when published. The
 * brief must never claim camera scores are legal determinations.
 */

import { LEY_7600_MIN_SCORE, type SegmentCollection, type SegmentFeature } from "./types";

export type DistrictCompliance = {
  district: string;
  observed: number;
  failing: number;
  passRatePct: number;
  failRatePct: number;
  meanAccessibility: number | null;
};

export type WorstCorridor = {
  id: string;
  name: string;
  district: string;
  accessibility: number;
  source: "cv" | "audit" | "mixed" | "unknown";
};

export type LeyBriefSummary = {
  threshold: number;
  observed: number;
  failing: number;
  failRatePct: number;
  districts: DistrictCompliance[];
  worstCorridors: WorstCorridor[];
};

/** True when the paint feature carries a usable accessibility reading. */
export function hasAccessibilityEvidence(f: SegmentFeature): boolean {
  const p = f.properties;
  if ((p.cv_count ?? 0) > 0 && typeof p.score_accessibility === "number") {
    return true;
  }
  const src = p.source;
  if (src === "import" || src === "community") return false;
  return Boolean(p.audited_at) && p.score_accessibility > 0;
}

function evidenceSource(f: SegmentFeature): WorstCorridor["source"] {
  const p = f.properties;
  const hasCv = (p.cv_count ?? 0) > 0;
  const hasAudit =
    Boolean(p.audited_at) &&
    p.score_accessibility > 0 &&
    p.source !== "import" &&
    p.source !== "community";
  if (hasCv && hasAudit) return "mixed";
  if (hasCv) return "cv";
  if (hasAudit) return "audit";
  return "unknown";
}

/**
 * Build the municipality-facing compliance summary from a paint FeatureCollection.
 * Only segments with accessibility evidence are counted.
 */
export function buildLeyBriefSummary(
  collection: SegmentCollection,
  worstLimit = 15,
): LeyBriefSummary {
  const observed = collection.features.filter(hasAccessibilityEvidence);
  const failing = observed.filter(
    (f) => f.properties.score_accessibility < LEY_7600_MIN_SCORE,
  );

  const byDistrict = new Map<
    string,
    { observed: number; failing: number; sum: number }
  >();
  for (const f of observed) {
    const key = f.properties.district || "Unknown";
    const entry = byDistrict.get(key) ?? { observed: 0, failing: 0, sum: 0 };
    entry.observed += 1;
    entry.sum += f.properties.score_accessibility;
    if (f.properties.score_accessibility < LEY_7600_MIN_SCORE) {
      entry.failing += 1;
    }
    byDistrict.set(key, entry);
  }

  const districts: DistrictCompliance[] = [...byDistrict.entries()]
    .map(([district, { observed: n, failing: fail, sum }]) => ({
      district,
      observed: n,
      failing: fail,
      failRatePct: n ? Math.round((fail / n) * 100) : 0,
      passRatePct: n ? Math.round(((n - fail) / n) * 100) : 0,
      meanAccessibility: n ? Math.round(sum / n) : null,
    }))
    .sort((a, b) => b.failRatePct - a.failRatePct || b.observed - a.observed);

  const worstCorridors: WorstCorridor[] = [...observed]
    .sort(
      (a, b) =>
        a.properties.score_accessibility - b.properties.score_accessibility ||
        a.properties.name.localeCompare(b.properties.name),
    )
    .slice(0, Math.max(0, worstLimit))
    .map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      district: f.properties.district,
      accessibility: f.properties.score_accessibility,
      source: evidenceSource(f),
    }));

  const n = observed.length;
  return {
    threshold: LEY_7600_MIN_SCORE,
    observed: n,
    failing: failing.length,
    failRatePct: n ? Math.round((failing.length / n) * 100) : 0,
    districts,
    worstCorridors,
  };
}
