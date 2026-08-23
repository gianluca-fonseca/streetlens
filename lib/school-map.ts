/**
 * The school wire: what the map needs, and nothing else.
 *
 * The full report carries the contribution table — one row per segment in the
 * zone, with per-lens points. Across thirty-three schools that is several
 * hundred rows the browser would download and never render, so the public map
 * gets this reduced shape instead and the table stays on the admin, which is
 * the only surface that asks "how did each thing count".
 *
 * Segment GEOMETRY is deliberately absent. The zone's streets and its gaps are
 * already drawn by the map from the segments source; sending them again would
 * duplicate the heaviest payload on the page. Ids are enough to filter what is
 * already there.
 */

import { geodesicCircle } from "@/components/mapConfig";
import type { SchoolReport } from "./school-report";
import type { SchoolTier } from "./school-score";

export type SchoolZoneWire = {
  school_id: string;
  center: [number, number];
  gate_radius_m: number;
  walk_radius_m: number;
  tier: SchoolTier;
  score: number | null;
  compliance: number | null;
  coverage: number;
  /** Segments the score is computed from. */
  member_ids: string[];
  /** Segments in the zone nobody has recorded — the field backlog. */
  gap_ids: string[];
  gap_length_m: number;
  gate_gap_ids: string[];
};

export type SchoolZoneCollection = {
  /** Ring polygons, ready to paint. Built server-side so every client does not
   *  redo the same trigonometry on load. */
  rings: GeoJSON.FeatureCollection;
  zones: SchoolZoneWire[];
  /** Every gap id across every school, for the one backlog layer. */
  all_gap_ids: string[];
};

/** Reduce reports to the map wire, including the pre-built ring polygons. */
export function toSchoolZoneCollection(reports: SchoolReport[]): SchoolZoneCollection {
  const zones: SchoolZoneWire[] = [];
  const rings: GeoJSON.Feature[] = [];
  const allGaps = new Set<string>();

  for (const r of reports) {
    if (!r.zone) continue;
    const center = r.center;

    const gateGaps = r.gaps.filter((g) => g.ring === "gate").map((g) => g.segment_id);
    const gapIds = r.gaps.map((g) => g.segment_id);
    for (const id of gapIds) allGaps.add(id);

    zones.push({
      school_id: r.school.id,
      center,
      gate_radius_m: r.zone.gate_radius_m,
      walk_radius_m: r.zone.walk_radius_m,
      tier: r.published.tier,
      score: r.published.score,
      compliance: r.published.compliance,
      coverage: r.computed.coverage,
      member_ids: r.computed.contributions.map((c) => c.segment_id),
      gap_ids: gapIds,
      gap_length_m: r.gap_length_m,
      gate_gap_ids: gateGaps,
    });

    for (const [ring, radius] of [
      ["walk", r.zone.walk_radius_m],
      ["gate", r.zone.gate_radius_m],
    ] as const) {
      rings.push({
        type: "Feature",
        id: `${r.school.id}-${ring}`,
        geometry: { type: "Polygon", coordinates: [geodesicCircle(center, radius)] },
        properties: {
          school_id: r.school.id,
          ring,
          tier: r.published.tier,
          // Carried on the feature so the ring can be styled by state without
          // the paint expression needing a second source to join against.
          has_gaps: gapIds.length > 0,
        },
      });
    }
  }

  return {
    rings: { type: "FeatureCollection", features: rings },
    zones,
    all_gap_ids: [...allGaps],
  };
}
