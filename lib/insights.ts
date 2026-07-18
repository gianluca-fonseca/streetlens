/**
 * Pure aggregations for the public Insights instrument panel.
 *
 * Camera-observed vs field-audited counters are never mixed: every helper that
 * reads CV stubs / observations is labeled as camera work; audited rollups
 * only touch published score_* when an audit is present.
 */

import type {
  CvObservation,
  ScoreLayer,
  SegmentCollection,
  SegmentFeature,
  SegmentProperties,
} from "@/lib/types";
import { LEY_7600_MIN_SCORE, SCORE_LAYERS } from "@/lib/types";

/** Sealed legend bins — mirrors `BINS` in components/mapConfig.ts (no maplibre import). */
const BINS = [
  { key: "excellent", min: 80, max: 100 },
  { key: "good", min: 60, max: 79 },
  { key: "fair", min: 40, max: 59 },
  { key: "poor", min: 0, max: 39 },
] as const;

type LegendBinKey = (typeof BINS)[number]["key"];

export type WorstCvStreet = {
  id: string;
  name: string;
  district: string;
  score: number;
  layer: ScoreLayer;
  captured_on: string;
};

export type DistrictRollup = {
  name: string;
  segmentCount: number;
  networkKm: number;
  cvSegmentCount: number;
  cvKm: number;
  cvCoveragePct: number;
  /** Mean canonical camera overall, or null when none observed. */
  meanCvOverall: number | null;
  meanCvAccessibility: number | null;
  /** Audited Ley fail share among audited segments in this district, or null. */
  auditedLeyFailPct: number | null;
  auditedSegmentCount: number;
};

export type BinShare = {
  key: LegendBinKey;
  min: number;
  max: number;
  count: number;
  share: number;
};

export type LensDistribution = {
  layer: ScoreLayer;
  observed: number;
  bins: BinShare[];
  mean: number | null;
};

export type TimelineEvent = {
  /** Day key YYYY-MM-DD (UTC). */
  day: string;
  captured_on: string;
  segmentIds: string[];
  streetNames: string[];
  districts: string[];
  meanOverall: number | null;
  segmentCount: number;
};

export type CoverageProgressPoint = {
  day: string;
  cumulativeKm: number;
  cumulativeSegments: number;
};

export type CoverageProgress = {
  networkKm: number;
  observedKm: number;
  observedPct: number;
  points: CoverageProgressPoint[];
};

function isAudited(props: SegmentProperties): boolean {
  const src = props.source;
  if (src === "import" || src === "community") return false;
  return Boolean(props.audited_at) && props.score_overall > 0;
}

function cvStubScore(
  props: SegmentProperties,
  layer: ScoreLayer,
): number | null {
  const key = `cv_${layer}` as keyof SegmentProperties;
  const v = props[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function binForScore(score: number): LegendBinKey {
  for (const b of BINS) {
    if (score >= b.min && score <= b.max) return b.key;
  }
  return score >= 80 ? "excellent" : "poor";
}

/**
 * Lowest canonical camera scores, deduped by street name (worst segment wins).
 * Clearly camera-observed — never uses audited score_*.
 */
export function listWorstCvStreets(
  segments: SegmentCollection,
  options: { limit?: number; layer?: ScoreLayer } = {},
): WorstCvStreet[] {
  const limit = options.limit ?? 10;
  const layer = options.layer ?? "overall";
  const byStreet = new Map<string, WorstCvStreet>();

  for (const f of segments.features) {
    const p = f.properties;
    if ((p.cv_count ?? 0) <= 0) continue;
    const score = cvStubScore(p, layer);
    if (score === null) continue;
    // Paint wire omits cv_observations; captured_on is filled by the data loader
    // when walk dates are joined. Ranking uses stub scores only.
    const row: WorstCvStreet = {
      id: p.id,
      name: p.name,
      district: p.district,
      score,
      layer,
      captured_on: "",
    };
    const prev = byStreet.get(p.name);
    if (!prev || score < prev.score) byStreet.set(p.name, row);
  }

  return [...byStreet.values()]
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Per-district rollups derived from segment.district values — never a fixed
 * three-name list.
 */
export function computeDistrictRollups(
  segments: SegmentCollection,
  lengthById: ReadonlyMap<string, number>,
): DistrictRollup[] {
  type Acc = {
    segmentCount: number;
    networkM: number;
    cvSegmentCount: number;
    cvM: number;
    cvOverall: number[];
    cvAccess: number[];
    auditedCount: number;
    auditedLeyFail: number;
  };
  const by = new Map<string, Acc>();

  for (const f of segments.features) {
    const p = f.properties;
    const name = (p.district || "").trim() || "Unknown";
    const acc = by.get(name) ?? {
      segmentCount: 0,
      networkM: 0,
      cvSegmentCount: 0,
      cvM: 0,
      cvOverall: [],
      cvAccess: [],
      auditedCount: 0,
      auditedLeyFail: 0,
    };
    acc.segmentCount += 1;
    const len = lengthById.get(p.id) ?? 0;
    acc.networkM += len;

    if ((p.cv_count ?? 0) > 0) {
      acc.cvSegmentCount += 1;
      acc.cvM += len;
      const overall = cvStubScore(p, "overall");
      const access = cvStubScore(p, "accessibility");
      if (overall !== null) acc.cvOverall.push(overall);
      if (access !== null) acc.cvAccess.push(access);
    }

    if (isAudited(p)) {
      acc.auditedCount += 1;
      if (p.score_accessibility < LEY_7600_MIN_SCORE) acc.auditedLeyFail += 1;
    }

    by.set(name, acc);
  }

  return [...by.entries()]
    .map(([name, acc]) => {
      const networkKm = acc.networkM / 1000;
      const cvKm = acc.cvM / 1000;
      return {
        name,
        segmentCount: acc.segmentCount,
        networkKm: Number(networkKm.toFixed(2)),
        cvSegmentCount: acc.cvSegmentCount,
        cvKm: Number(cvKm.toFixed(2)),
        cvCoveragePct:
          acc.networkM > 0 ? (acc.cvM / acc.networkM) * 100 : 0,
        meanCvOverall: mean(acc.cvOverall),
        meanCvAccessibility: mean(acc.cvAccess),
        auditedSegmentCount: acc.auditedCount,
        auditedLeyFailPct:
          acc.auditedCount > 0
            ? Math.round((acc.auditedLeyFail / acc.auditedCount) * 100)
            : null,
      } satisfies DistrictRollup;
    })
    .sort((a, b) => b.segmentCount - a.segmentCount || a.name.localeCompare(b.name));
}

/** Bin shares for one lens among camera-observed segments. */
export function computeLensDistribution(
  segments: SegmentCollection,
  layer: ScoreLayer,
): LensDistribution {
  const scores: number[] = [];
  for (const f of segments.features) {
    if ((f.properties.cv_count ?? 0) <= 0) continue;
    const s = cvStubScore(f.properties, layer);
    if (s !== null) scores.push(s);
  }
  const counts = Object.fromEntries(BINS.map((b) => [b.key, 0])) as Record<
    LegendBinKey,
    number
  >;
  for (const s of scores) counts[binForScore(s)] += 1;
  const n = scores.length;
  return {
    layer,
    observed: n,
    mean: mean(scores),
    bins: BINS.map((b) => ({
      key: b.key,
      min: b.min,
      max: b.max,
      count: counts[b.key],
      share: n > 0 ? counts[b.key] / n : 0,
    })),
  };
}

export function computeAllLensDistributions(
  segments: SegmentCollection,
): LensDistribution[] {
  return SCORE_LAYERS.map((layer) => computeLensDistribution(segments, layer));
}

export type ScrubbedWalk = {
  segment_id: string;
  captured_on: string;
  scores: Record<ScoreLayer, number | null>;
};

/**
 * Chronological feed of camera walks, grouped by UTC day.
 * Input must already be scrubbed (no session_id / frame_refs).
 */
export function buildObservationTimeline(
  walks: readonly ScrubbedWalk[],
  segmentIndex: ReadonlyMap<string, Pick<SegmentProperties, "name" | "district">>,
  limit = 20,
): TimelineEvent[] {
  const byDay = new Map<
    string,
    {
      captured_on: string;
      ids: Set<string>;
      overalls: number[];
    }
  >();

  for (const w of walks) {
    if (!w.captured_on) continue;
    const day = dayKey(w.captured_on);
    if (!day) continue;
    const entry = byDay.get(day) ?? {
      captured_on: w.captured_on,
      ids: new Set<string>(),
      overalls: [],
    };
    entry.ids.add(w.segment_id);
    if (w.captured_on > entry.captured_on) entry.captured_on = w.captured_on;
    const o = w.scores.overall;
    if (typeof o === "number" && Number.isFinite(o)) entry.overalls.push(o);
    byDay.set(day, entry);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([day, entry]) => {
      const segmentIds = [...entry.ids];
      const streetNames: string[] = [];
      const districts: string[] = [];
      const seenName = new Set<string>();
      const seenDist = new Set<string>();
      for (const id of segmentIds) {
        const meta = segmentIndex.get(id);
        if (!meta) continue;
        if (!seenName.has(meta.name)) {
          seenName.add(meta.name);
          streetNames.push(meta.name);
        }
        if (!seenDist.has(meta.district)) {
          seenDist.add(meta.district);
          districts.push(meta.district);
        }
      }
      return {
        day,
        captured_on: entry.captured_on,
        segmentIds,
        streetNames,
        districts,
        meanOverall: mean(entry.overalls),
        segmentCount: segmentIds.length,
      };
    });
}

/**
 * Cumulative camera-observed km by walk day (coverage progress over time).
 */
export function computeCoverageProgress(
  walks: readonly ScrubbedWalk[],
  lengthById: ReadonlyMap<string, number>,
  networkTotalM: number,
): CoverageProgress {
  const networkKm = networkTotalM / 1000;
  const byDay = new Map<string, Set<string>>();
  for (const w of walks) {
    const day = dayKey(w.captured_on);
    if (!day) continue;
    const set = byDay.get(day) ?? new Set<string>();
    set.add(w.segment_id);
    byDay.set(day, set);
  }

  const days = [...byDay.keys()].sort((a, b) => a.localeCompare(b));
  const seen = new Set<string>();
  const points: CoverageProgressPoint[] = [];
  let observedM = 0;

  for (const day of days) {
    for (const id of byDay.get(day) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      observedM += lengthById.get(id) ?? 0;
    }
    points.push({
      day,
      cumulativeKm: Number((observedM / 1000).toFixed(3)),
      cumulativeSegments: seen.size,
    });
  }

  return {
    networkKm: Number(networkKm.toFixed(2)),
    observedKm: Number((observedM / 1000).toFixed(3)),
    observedPct: networkTotalM > 0 ? (observedM / networkTotalM) * 100 : 0,
    points,
  };
}

/** Index features by id for timeline joins. */
export function indexSegmentsById(
  segments: SegmentCollection,
): Map<string, SegmentFeature["properties"]> {
  const m = new Map<string, SegmentFeature["properties"]>();
  for (const f of segments.features) m.set(f.properties.id, f.properties);
  return m;
}

/** Scrub CV rows for public timeline (drop session / frames). */
export function scrubWalksForTimeline(
  observations: readonly CvObservation[],
): ScrubbedWalk[] {
  return observations.map((o) => ({
    segment_id: o.segment_id,
    captured_on: o.captured_on,
    scores: { ...o.scores },
  }));
}
