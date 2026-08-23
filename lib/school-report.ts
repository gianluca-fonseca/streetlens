/**
 * The join: roster + zone + LIVE segment readings + human edits → one report.
 *
 * This is the only place a school's published numbers come from, and it
 * recomputes them on every read rather than serving a stored snapshot. That is
 * deliberate. A school's score is a statement about the streets around it right
 * now; the moment a capture is reviewed or a field audit lands, the number has
 * to move. A cached score is a score that is quietly wrong between refreshes,
 * and "the dashboard said 62" is exactly the argument that loses a partner's
 * trust.
 *
 * What the admin's "refresh" therefore does is NOT recompute the score — this
 * function already did. It re-runs the written assessment against the new
 * numbers and stamps when a human last looked. See app/api/admin/schools.
 *
 * Layering, innermost first:
 *   data/schools.geojson      the MEP register (generated, read-only)
 *   data/school-zones.json    walkshed membership (generated, read-only)
 *   getSegments()             the current reading of every street
 *   school-store overlays     profile, override, assessment (human, editable)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSchools, type SchoolProperties } from "./schools";
import { getSegments } from "./segments";
import {
  computePriority,
  computeSchoolScore,
  COVERAGE,
  EXPOSURE_WEIGHT,
  SCHOOL_ZONE,
  type MemberContribution,
  type Priority,
  type SchoolScore,
  type SchoolTier,
  type SegmentReading,
  type ZoneMember,
} from "./school-score";
import {
  readSchoolAssessmentMap,
  readSchoolOverrideMap,
  readSchoolProfileMap,
  type SchoolAssessment,
  type SchoolOverride,
  type SchoolProfile,
} from "./school-store";
import type { SegmentFeature } from "./types";

const ZONES_PATH = path.join(process.cwd(), "data", "school-zones.json");

export type SchoolZone = {
  school_id: string;
  name: string;
  snap_m: number;
  length_m: { total: number; gate: number };
  counts: { members: number; gate: number };
  members: ZoneMember[];
};

type ZoneFile = {
  generated_by: string;
  gate_radius_m: number;
  walk_radius_m: number;
  totals: Record<string, number>;
  zones: SchoolZone[];
};

const EMPTY_ZONES: ZoneFile = {
  generated_by: "scripts/build-school-zones.mjs",
  gate_radius_m: SCHOOL_ZONE.GATE_RADIUS_M,
  walk_radius_m: SCHOOL_ZONE.WALK_RADIUS_M,
  totals: {},
  zones: [],
};

let zoneCache: Promise<ZoneFile> | null = null;

/** Precomputed walkshed membership. Missing file → empty, never a throw: the
 *  schools surface should degrade to "no zones yet", not to a 500. */
export function getSchoolZones(): Promise<ZoneFile> {
  zoneCache ??= fs
    .readFile(ZONES_PATH, "utf8")
    .then((raw) => JSON.parse(raw) as ZoneFile)
    .catch((err) => {
      console.warn("[school-zones] falling back to empty:", (err as Error).message);
      return EMPTY_ZONES;
    });
  return zoneCache;
}

/** Test seam. */
export function resetSchoolZoneCache(): void {
  zoneCache = null;
}

/* ------------------------------------------------------------------ *
 * Segment readings
 * ------------------------------------------------------------------ */

/**
 * Turn a paint feature into a reading, or null when the street has never
 * actually been looked at.
 *
 * The distinction between "scored 0" and "unscored" is the single most
 * important thing this module gets right. Every segment on the wire carries
 * numeric score fields; an unaudited one carries zeros. Treating those zeros as
 * data would drag every school's score toward zero in proportion to how little
 * we have surveyed — turning ignorance into a finding, and a well-surveyed
 * school into a worse-looking one than an unsurveyed neighbour. So an unscored
 * segment contributes NOTHING to the score and instead counts against coverage,
 * which is the honest place for it.
 *
 * Mirrors `hasAccessibilityEvidence` in lib/ley-brief.ts — the same question,
 * asked by the compliance brief.
 */
export function readingForFeature(f: SegmentFeature): SegmentReading | null {
  const p = f.properties;
  const hasCamera = (p.cv_count ?? 0) > 0 && typeof p.score_accessibility === "number";
  const isDerived = p.source === "import" || p.source === "community";
  const hasAudit = !isDerived && Boolean(p.audited_at) && p.score_overall > 0;

  if (!hasCamera && !hasAudit) return null;

  return {
    segment_id: p.id,
    name: p.name,
    district: p.district ?? null,
    scores: {
      accessibility: p.score_accessibility,
      drainage: p.score_drainage,
      shade: p.score_shade,
      bike: p.score_bike,
    },
    // A field audit outranks a camera pass, and the seal turns on the
    // difference, so the label follows the stronger evidence.
    source: hasAudit ? "audit" : "camera",
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

/** A segment inside the zone that nobody has recorded yet — the field backlog. */
export type CaptureGap = {
  segment_id: string;
  ring: "gate" | "walk";
  walk_m: number;
  length_m: number;
};

export type PublishedReading = {
  tier: SchoolTier;
  score: number | null;
  compliance: number | null;
  /** True when a human overrode the computed reading. Surfaces as a label. */
  overridden: boolean;
};

export type SchoolReport = {
  school: SchoolProperties;
  /** The pin's coordinate. Carried on the report so every consumer that needs
   *  to draw or route to the school does not have to re-open the roster. */
  center: [number, number];
  /** Register values with the admin's profile edits applied. */
  display_name: string;
  address: string | null;
  profile: SchoolProfile | null;
  zone: {
    gate_radius_m: number;
    walk_radius_m: number;
    snap_m: number;
    counts: { members: number; gate: number };
    length_m: { total: number; gate: number };
  } | null;
  /** What the arithmetic says, always, even when an override hides it. */
  computed: SchoolScore;
  /** What the public sees. */
  published: PublishedReading;
  override: SchoolOverride | null;
  assessment: SchoolAssessment | null;
  priority: Priority;
  /** Unassessed segments in the zone, nearest first: what to go record. */
  gaps: CaptureGap[];
  /** Metres of unassessed street in the zone. The field-work estimate. */
  gap_length_m: number;
};

const EMPTY_SCORE = (): SchoolScore =>
  computeSchoolScore([], new Map(), { hasFieldAudit: false });

/**
 * Build every school's report. One pass over the segments, shared across all
 * thirty-three zones — the alternative (a segment lookup per school) re-walks a
 * 1,457-feature collection thirty-three times for no gain.
 */
export async function getSchoolReports(demoEnabled: boolean): Promise<SchoolReport[]> {
  const [schools, zoneFile, segments, profiles, overrides, assessments] = await Promise.all([
    getSchools(),
    getSchoolZones(),
    getSegments(demoEnabled),
    readSchoolProfileMap(),
    readSchoolOverrideMap(),
    readSchoolAssessmentMap(),
  ]);

  const readings = new Map<string, SegmentReading>();
  for (const f of segments.features) {
    const reading = readingForFeature(f);
    if (reading) readings.set(reading.segment_id, reading);
  }

  const zoneById = new Map(zoneFile.zones.map((z) => [z.school_id, z]));

  return schools.features.map((feature) => {
    const school = feature.properties;
    const zone = zoneById.get(school.id) ?? null;
    const profile = profiles.get(school.id) ?? null;
    const override = overrides.get(school.id) ?? null;

    const members = zone?.members ?? [];
    const hasFieldAudit = members.some(
      (m) => readings.get(m.segment_id)?.source === "audit",
    );
    const computed = zone
      ? computeSchoolScore(members, readings, { hasFieldAudit })
      : EMPTY_SCORE();

    const gaps: CaptureGap[] = members
      .filter((m) => !readings.has(m.segment_id))
      .map((m) => ({
        segment_id: m.segment_id,
        ring: m.ring,
        walk_m: m.walk_m,
        length_m: m.length_m,
      }))
      .sort((a, b) => a.walk_m - b.walk_m);

    const published: PublishedReading = {
      tier: override?.tier ?? computed.tier,
      score: override?.score ?? computed.score,
      compliance: computed.compliance,
      overridden: Boolean(override?.tier || typeof override?.score === "number"),
    };

    const gatePoints = computed.defects
      .filter((d) => d.ring === "gate")
      .reduce((m, d) => m + d.points_recoverable, 0);
    const totalPoints = computed.defects.reduce((m, d) => m + d.points_recoverable, 0);

    const level = (profile?.level ?? school.level ?? null) as
      | keyof typeof EXPOSURE_WEIGHT.level
      | null;

    return {
      school,
      center: feature.geometry.coordinates,
      display_name: profile?.display_name?.trim() || school.display_name,
      address: profile?.address?.trim() || school.address,
      profile,
      zone: zone
        ? {
            gate_radius_m: zoneFile.gate_radius_m,
            walk_radius_m: zoneFile.walk_radius_m,
            snap_m: zone.snap_m,
            counts: zone.counts,
            length_m: zone.length_m,
          }
        : null,
      computed,
      published,
      override,
      assessment: assessments.get(school.id) ?? null,
      priority: computePriority({
        score: published.score,
        coverage: computed.coverage,
        gate_veto: computed.gate_veto,
        sector: school.sector,
        level,
        gate_points_recoverable: gatePoints,
        total_points_recoverable: totalPoints,
      }),
      gaps,
      gap_length_m: Number(gaps.reduce((m, g) => m + g.length_m, 0).toFixed(1)),
    };
  });
}

/** One school's report, or null when the id is unknown. */
export async function getSchoolReport(
  id: string,
  demoEnabled: boolean,
): Promise<SchoolReport | null> {
  const all = await getSchoolReports(demoEnabled);
  return all.find((r) => r.school.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Rollups
 * ------------------------------------------------------------------ */

export type SchoolsSummary = {
  schools: number;
  scored: number;
  awaiting_data: number;
  sealed: number;
  /** Mean published score across the schools that have one. */
  mean_score: number | null;
  by_tier: Record<SchoolTier, number>;
  /** Metres of street inside a school zone, and how much is still unrecorded. */
  zone_length_m: number;
  gap_length_m: number;
  coverage: number;
};

export function summarizeSchools(reports: SchoolReport[]): SchoolsSummary {
  const by_tier: Record<SchoolTier, number> = {
    sin_datos: 0,
    critico: 0,
    en_riesgo: 0,
    en_progreso: 0,
    escuela_segura: 0,
  };
  let zoneLength = 0;
  let gapLength = 0;
  const scores: number[] = [];

  for (const r of reports) {
    by_tier[r.published.tier] += 1;
    zoneLength += r.computed.length_m.total;
    gapLength += r.gap_length_m;
    if (typeof r.published.score === "number") scores.push(r.published.score);
  }

  return {
    schools: reports.length,
    scored: scores.length,
    awaiting_data: by_tier.sin_datos,
    sealed: by_tier.escuela_segura,
    mean_score: scores.length
      ? Number((scores.reduce((m, s) => m + s, 0) / scores.length).toFixed(1))
      : null,
    by_tier,
    zone_length_m: Number(zoneLength.toFixed(1)),
    gap_length_m: Number(gapLength.toFixed(1)),
    coverage: zoneLength > 0 ? Number(((zoneLength - gapLength) / zoneLength).toFixed(4)) : 0,
  };
}

/**
 * The leaderboard: schools ordered best-first by what they have EARNED.
 *
 * Unscored schools sort to the bottom regardless, and carry no rank number.
 * Ranking a school 30th because nobody has surveyed it would read as a verdict
 * on the school when it is a verdict on us, and the seal loses its meaning the
 * moment an absence of evidence looks like evidence of absence.
 */
export function leaderboard(reports: SchoolReport[]): SchoolReport[] {
  const ranked = reports.filter((r) => typeof r.published.score === "number");
  const unranked = reports.filter((r) => typeof r.published.score !== "number");
  ranked.sort((a, b) => {
    const byCompliance = (b.published.compliance ?? 0) - (a.published.compliance ?? 0);
    if (Math.abs(byCompliance) > 1e-6) return byCompliance;
    return (b.published.score ?? 0) - (a.published.score ?? 0);
  });
  unranked.sort((a, b) => b.computed.coverage - a.computed.coverage);
  return [...ranked, ...unranked];
}

/**
 * The intervention list — Amadeo's "ten schools you can act on".
 *
 * Ordered by priority, not by badness: an unsurveyed school has no priority
 * number, and a merely-bad school with an expensive corridor problem ranks below
 * a bad one whose gate needs a crossing.
 */
export function interventionList(reports: SchoolReport[], limit = 10): SchoolReport[] {
  return reports
    .filter((r) => typeof r.priority.rank_score === "number")
    .sort((a, b) => (b.priority.rank_score ?? 0) - (a.priority.rank_score ?? 0))
    .slice(0, limit);
}

/**
 * The capture backlog, worst-covered first: where a camera should go next.
 *
 * Sorted by how much a session there would ADD, not by how bad the coverage is:
 * a school missing 900 m inside its gate ring is a better afternoon than one
 * missing 200 m at the edge of its walk ring, and gate metres count double for
 * the same reason they do in the score.
 */
export function captureBacklog(reports: SchoolReport[]): {
  report: SchoolReport;
  gate_gap_m: number;
  value: number;
}[] {
  return reports
    .filter((r) => r.gaps.length > 0)
    .map((r) => {
      const gateGap = r.gaps
        .filter((g) => g.ring === "gate")
        .reduce((m, g) => m + g.length_m, 0);
      return {
        report: r,
        gate_gap_m: Number(gateGap.toFixed(1)),
        value: Number((gateGap * SCHOOL_ZONE.RING_WEIGHT.gate + (r.gap_length_m - gateGap)).toFixed(1)),
      };
    })
    .sort((a, b) => b.value - a.value);
}

export { COVERAGE, SCHOOL_ZONE };
export type { MemberContribution, Priority, SchoolScore, SchoolTier };
