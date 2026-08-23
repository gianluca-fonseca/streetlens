/**
 * The School Score — the "Escuela Segura" standard, as arithmetic.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is NOT a new measurement. Nothing here looks at a photo, a frame, or a
 * video. The measuring pipeline is the one that already exists: a capture walk
 * becomes keyframes, keyframes become per-segment lens scores, a field audit
 * can override them. This module only AGGREGATES those existing segment scores
 * over the streets around a school.
 *
 * That constraint is the whole design. A second, school-specific measurement
 * would need its own rubric, its own evidence, and its own defence — and would
 * let a school's score disagree with the streets drawn underneath it, which is
 * the one thing a reader would never forgive. One pipeline, two readings.
 *
 * ── THE ZONE ───────────────────────────────────────────────────────────────
 * Two rings, both measured as WALKING DISTANCE along the street network rather
 * than as a straight line from the gate:
 *
 *   portón / gate   150 m   the approach — the crossing outside the gate, the
 *                           drop-off, the first block. Where school-zone speed
 *                           rules apply and where a fix is cheapest.
 *   trayecto / walk 400 m   the walking catchment, about five minutes at a
 *                           child's pace. The streets children actually arrive on.
 *
 * Straight-line radius was rejected: a 400 m circle drawn on Escazú includes
 * streets across the Próspero Fernández that no child has ever walked to school
 * on, and scoring them would be exactly the "measuring the wrong thing"
 * failure that discredits the whole instrument. The map still DRAWS a circle,
 * because a circle is legible at a glance — but the streets inside it that the
 * walkshed cannot reach are drawn dim and excluded here, so the difference
 * between the marker and the measurement is visible rather than hidden.
 *
 * ── THE TWO NUMBERS ────────────────────────────────────────────────────────
 * A school carries a TIER and a SCORE, and they answer different questions.
 *
 *   compliance → tier    What share of the walk to school meets Ley 7600?
 *                        This drives the seal. It is anchored to law, so it is
 *                        arguable in front of a ministry rather than being a
 *                        curve we invented.
 *   score 0–100          A weighted composite of the four lenses, tuned for a
 *                        walking child. This is the diagnostic: it says WHAT to
 *                        fix and lets thirty-three schools be ranked, which a
 *                        pass/fail share cannot do.
 *
 * ── WHY THESE LENS WEIGHTS ─────────────────────────────────────────────────
 * The composite deliberately does NOT reuse `score_overall`. That lens answers
 * "is this a good street", which is a different question from "is this a safe
 * walk to school for a seven-year-old". The four sub-lenses are re-weighted for
 * the child:
 *
 *   accessibility 45%   sidewalk continuity, ramps, crossings. The thing that
 *                       kills. Also the lens Ley 7600 legislates.
 *   drainage      20%   a sidewalk that floods in the rainy season puts a child
 *                       in the traffic lane; in this canton that is a seasonal
 *                       certainty, not an edge case.
 *   shade         20%   tropical midday sun on a walk home, and a proxy for a
 *                       street with a planted buffer between child and traffic.
 *   bike          15%   secondary students arrive on bikes, and separated
 *                       infrastructure means a buffer even for those on foot.
 *
 * Crash density is declared at weight zero with a date. Amadeo's note was that
 * camera data alone is not enough and crash records are what make a "critical
 * zone" claim defensible; carrying the term at zero states the gap on the face
 * of the formula instead of leaving a reader to notice its absence.
 *
 * ── THE RULES THAT PROTECT THE SEAL ────────────────────────────────────────
 * Two, and they matter more than the weights.
 *
 * COVERAGE GATE. A zone where most of the walk has never been assessed cannot
 * be scored at all — it publishes as `sin_datos`, with no tier and no number.
 * Today that is the majority of the canton, and saying so plainly is the point:
 * a green score computed from three observed segments is precisely the
 * methodology failure that would end the partnership conversation.
 *
 * GATE VETO. One segment in the 150 m ring below {@link GATE_VETO_MAX} caps the
 * whole school at `critico`, whatever the average says. A certification that can
 * be earned by averaging away a lethal gap outside the gate is worth nothing,
 * and a mean is very good at hiding exactly one bad block.
 *
 * ── CALIBRATION ────────────────────────────────────────────────────────────
 * The tier cuts come from the standard's INTENT (85% ≈ "essentially the whole
 * walk is legal"), not from fitting a distribution. They have not been
 * calibrated against real field data, because there is not yet enough of it —
 * and calibrating against the demo era would produce a number that looks
 * rigorous and means nothing. They live in one block, named, so recalibration
 * is an edit here and a changelog line, never a hunt through the codebase.
 */

import { LEY_7600_MIN_SCORE, type ScoreLayer } from "./types";

/* ------------------------------------------------------------------ *
 * The standard — one block, deliberately. See CALIBRATION above.
 * ------------------------------------------------------------------ */

/** Walking-distance radii, in metres, and how much each ring counts. */
export const SCHOOL_ZONE = {
  GATE_RADIUS_M: 150,
  WALK_RADIUS_M: 400,
  /** The gate counts double: thirty metres outside the door is not the same
   *  street as one three hundred metres away, and a flat mean says it is. */
  RING_WEIGHT: { gate: 2, walk: 1 } as const,
} as const;

/** Rings, outermost last. */
export type SchoolRing = "gate" | "walk";

/** Lens weights for the 0–100 composite. Must sum to 1. */
export const LENS_WEIGHTS: Record<Exclude<ScoreLayer, "overall">, number> = {
  accessibility: 0.45,
  drainage: 0.2,
  shade: 0.2,
  bike: 0.15,
};

/** The lenses the composite is built from, in reporting order. */
export const SCHOOL_LENSES = Object.keys(LENS_WEIGHTS) as Exclude<ScoreLayer, "overall">[];

/**
 * Crash density: declared, weighted zero, dated. Not an oversight — a stated
 * gap. See the header note on why it is carried rather than omitted.
 */
export const CRASH_COMPONENT = {
  weight: 0,
  status: "not_yet_incorporated",
  note: "Requires a crash/incident feed (Waze CCP, COSEVI, or municipal records). Until one lands, no school's score reflects collision history.",
} as const;

/** Share of the zone's weighted street length that must be assessed. */
export const COVERAGE = {
  /** Below this, the school publishes as `sin_datos` — no tier, no number. */
  MIN_FOR_SCORE: 0.6,
  /** The seal demands more than a passing score; it demands having looked. */
  MIN_FOR_SEAL: 0.8,
} as const;

/** One gate-ring segment below this accessibility score caps the school. */
export const GATE_VETO_MAX = 25;

/** The seal expires, like Bandera Azul. A street is not safe forever. */
export const SEAL_VALID_MONTHS = 24;

/** Ley 7600 accessibility minimum, shared with the compliance brief. */
export { LEY_7600_MIN_SCORE };

export type SchoolTier =
  | "sin_datos"
  | "critico"
  | "en_riesgo"
  | "en_progreso"
  | "escuela_segura";

/**
 * Compliance cuts, best first. `min` is the share of weighted walk length whose
 * accessibility clears Ley 7600.
 */
export const TIER_CUTS: { tier: Exclude<SchoolTier, "sin_datos">; min: number }[] = [
  { tier: "escuela_segura", min: 0.85 },
  { tier: "en_progreso", min: 0.65 },
  { tier: "en_riesgo", min: 0.4 },
  { tier: "critico", min: 0 },
];

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Per-lens numbers on a segment, as the paint wire carries them. */
export type LensScores = Record<Exclude<ScoreLayer, "overall">, number>;

/** A segment inside a school's zone, before scoring. Geometry-only, so it is
 *  precomputed once and never recomputed when scores change. */
export type ZoneMember = {
  segment_id: string;
  ring: SchoolRing;
  /** Walking distance from the school along the street network, in metres. */
  walk_m: number;
  length_m: number;
};

/** What the caller must hand in for each member: the CURRENT segment reading. */
export type SegmentReading = {
  segment_id: string;
  name: string;
  district: string | null;
  /** null when the segment has never been assessed (no audit, no camera). */
  scores: LensScores | null;
  /** How the reading was established, for the evidence column. */
  source: "audit" | "camera" | "none";
};

/** One row of the contribution table — the admin's "how did each thing count". */
export type MemberContribution = {
  segment_id: string;
  name: string;
  ring: SchoolRing;
  walk_m: number;
  length_m: number;
  source: SegmentReading["source"];
  assessed: boolean;
  scores: LensScores | null;
  /** length × ring weight. Zero for unassessed segments (they cannot score). */
  weight: number;
  /** This segment's share of the total scoring weight, 0–1. */
  weight_share: number;
  /** Points of the final 0–100 this segment is responsible for. */
  points: number;
  /** Points contributed per lens, so a reader can see WHICH lens drove it. */
  lens_points: Partial<Record<Exclude<ScoreLayer, "overall">, number>>;
  /** Ley 7600 verdict, or null when unassessed. */
  ley7600: "pass" | "fail" | null;
  /** This segment triggered the gate veto. */
  veto: boolean;
};

/** A named thing wrong in the zone, for the "what to fix" list. */
export type ZoneDefect = {
  lens: Exclude<ScoreLayer, "overall">;
  ring: SchoolRing;
  segment_id: string;
  name: string;
  score: number;
  /** Points the zone would gain by lifting this segment to the Ley 7600 floor. */
  points_recoverable: number;
};

export type SchoolScore = {
  tier: SchoolTier;
  /** 0–100 composite, or null when the coverage gate holds it back. */
  score: number | null;
  /** Share of weighted walk length clearing Ley 7600, 0–1, or null. */
  compliance: number | null;
  /** Share of the zone's street length that has any assessment, 0–1. */
  coverage: number;
  /** Per-lens weighted means, 0–100, or null where nothing was assessed. */
  lenses: Partial<Record<Exclude<ScoreLayer, "overall">, number | null>>;
  /** True when a gate-ring segment tripped {@link GATE_VETO_MAX}. */
  gate_veto: boolean;
  /** Segment ids responsible for the veto. */
  gate_veto_segments: string[];
  /** Whether the seal's non-score conditions are met, and which are missing. */
  seal: { eligible: boolean; blockers: string[] };
  counts: {
    members: number;
    assessed: number;
    gate_members: number;
    gate_assessed: number;
  };
  /** Metres of street in the zone, and how much of it is assessed. */
  length_m: { total: number; assessed: number };
  contributions: MemberContribution[];
  defects: ZoneDefect[];
};

/* ------------------------------------------------------------------ *
 * The computation
 * ------------------------------------------------------------------ */

function tierForCompliance(compliance: number): Exclude<SchoolTier, "sin_datos"> {
  for (const cut of TIER_CUTS) {
    if (compliance >= cut.min) return cut.tier;
  }
  return "critico";
}

/**
 * Score one school's zone from the CURRENT readings of the segments inside it.
 *
 * Pure and synchronous: no I/O, no clock, no database. That is what lets the
 * same function run at build time, in an admin refresh, and inside a test with
 * hand-written fixtures — and it is why a score can always be recomputed from
 * inputs rather than trusted because it was stored.
 *
 * `hasFieldAudit` is passed in rather than derived because "a human has stood
 * on this street" is a claim about evidence, not about numbers, and the seal
 * turns on it.
 */
export function computeSchoolScore(
  members: ZoneMember[],
  readings: Map<string, SegmentReading>,
  options: { hasFieldAudit?: boolean } = {},
): SchoolScore {
  const rows: MemberContribution[] = [];
  let totalLength = 0;
  let assessedLength = 0;
  let totalWeight = 0;

  // Pass 1: resolve each member against its current reading and its weight.
  for (const m of members) {
    const reading = readings.get(m.segment_id);
    const scores = reading?.scores ?? null;
    const assessed = scores !== null;
    const weight = assessed ? m.length_m * SCHOOL_ZONE.RING_WEIGHT[m.ring] : 0;

    totalLength += m.length_m;
    if (assessed) {
      assessedLength += m.length_m;
      totalWeight += weight;
    }

    rows.push({
      segment_id: m.segment_id,
      name: reading?.name ?? m.segment_id,
      ring: m.ring,
      walk_m: m.walk_m,
      length_m: m.length_m,
      source: reading?.source ?? "none",
      assessed,
      scores,
      weight,
      weight_share: 0,
      points: 0,
      lens_points: {},
      ley7600:
        scores === null
          ? null
          : scores.accessibility >= LEY_7600_MIN_SCORE
            ? "pass"
            : "fail",
      veto: assessed && m.ring === "gate" && scores.accessibility < GATE_VETO_MAX,
    });
  }

  const coverage = totalLength > 0 ? assessedLength / totalLength : 0;

  // Pass 2: shares, points, and the per-lens split. Done as a second pass
  // because a share needs the total, and the total needs every row.
  const lensTotals: Partial<Record<Exclude<ScoreLayer, "overall">, number>> = {};
  let compliantWeight = 0;

  for (const row of rows) {
    if (!row.assessed || totalWeight === 0) continue;
    row.weight_share = row.weight / totalWeight;
    if (row.ley7600 === "pass") compliantWeight += row.weight;

    let points = 0;
    for (const lens of SCHOOL_LENSES) {
      const value = row.scores![lens];
      const lensPoints = row.weight_share * LENS_WEIGHTS[lens] * value;
      row.lens_points[lens] = Number(lensPoints.toFixed(3));
      lensTotals[lens] = (lensTotals[lens] ?? 0) + row.weight_share * value;
      points += lensPoints;
    }
    row.points = Number(points.toFixed(3));
  }

  const gateVetoSegments = rows.filter((r) => r.veto).map((r) => r.segment_id);
  const scored = totalWeight > 0;
  const belowGate = coverage < COVERAGE.MIN_FOR_SCORE;

  const compliance = scored ? compliantWeight / totalWeight : null;
  const rawScore = scored
    ? Number(
        SCHOOL_LENSES.reduce(
          (sum, lens) => sum + LENS_WEIGHTS[lens] * (lensTotals[lens] ?? 0),
          0,
        ).toFixed(1),
      )
    : null;

  // The coverage gate is applied AFTER the arithmetic, not instead of it: the
  // admin still needs to see the provisional number and what produced it. It is
  // the PUBLISHED tier and score that are withheld.
  let tier: SchoolTier;
  if (belowGate || compliance === null) {
    tier = "sin_datos";
  } else {
    tier = tierForCompliance(compliance);
    if (gateVetoSegments.length > 0) tier = "critico";
  }

  // Seal conditions that are not the tier itself.
  const blockers: string[] = [];
  if (coverage < COVERAGE.MIN_FOR_SEAL) blockers.push("coverage");
  if (gateVetoSegments.length > 0) blockers.push("gate_veto");
  if (!options.hasFieldAudit) blockers.push("field_audit");
  if (tier !== "escuela_segura") blockers.push("tier");

  const lenses: SchoolScore["lenses"] = {};
  for (const lens of SCHOOL_LENSES) {
    lenses[lens] = scored ? Number((lensTotals[lens] ?? 0).toFixed(1)) : null;
  }

  // Defects: assessed segments failing Ley 7600, worst first, with what the
  // zone would recover by lifting each to the legal floor. "Recoverable" is the
  // honest way to rank a fix list — it is the actual arithmetic gain, not a
  // severity adjective.
  const defects: ZoneDefect[] = [];
  for (const row of rows) {
    if (!row.assessed || totalWeight === 0) continue;
    for (const lens of SCHOOL_LENSES) {
      const value = row.scores![lens];
      if (value >= LEY_7600_MIN_SCORE) continue;
      defects.push({
        lens,
        ring: row.ring,
        segment_id: row.segment_id,
        name: row.name,
        score: value,
        points_recoverable: Number(
          (row.weight_share * LENS_WEIGHTS[lens] * (LEY_7600_MIN_SCORE - value)).toFixed(2),
        ),
      });
    }
  }
  defects.sort((a, b) => b.points_recoverable - a.points_recoverable);

  rows.sort((a, b) => a.walk_m - b.walk_m);

  return {
    tier,
    score: belowGate ? null : rawScore,
    compliance: belowGate ? null : compliance,
    coverage: Number(coverage.toFixed(4)),
    lenses,
    gate_veto: gateVetoSegments.length > 0,
    gate_veto_segments: gateVetoSegments,
    seal: { eligible: blockers.length === 0, blockers },
    counts: {
      members: rows.length,
      assessed: rows.filter((r) => r.assessed).length,
      gate_members: rows.filter((r) => r.ring === "gate").length,
      gate_assessed: rows.filter((r) => r.ring === "gate" && r.assessed).length,
    },
    length_m: {
      total: Number(totalLength.toFixed(1)),
      assessed: Number(assessedLength.toFixed(1)),
    },
    contributions: rows,
    defects,
  };
}

/* ------------------------------------------------------------------ *
 * Intervention priority — the "ten schools you can act on" list
 * ------------------------------------------------------------------ */

/**
 * Exposure proxy, by sector and level.
 *
 * This is the weakest number in the standard and it is labelled as such
 * everywhere it surfaces. The right input is enrolment (matrícula), which the
 * MEP register this roster comes from does not carry. Until it does, exposure
 * is a proxy: public schools serve the children least able to choose a safer
 * route or be driven, and the youngest walk least predictably.
 */
export const EXPOSURE_WEIGHT = {
  sector: { public: 1, private: 0.55 },
  level: {
    preschool: 1.15,
    preschool_primary: 1.15,
    primary: 1.1,
    basica_general: 1,
    secondary: 0.85,
    adult: 0.3,
    unknown: 1,
  },
} as const;

export type PriorityInput = {
  score: number | null;
  coverage: number;
  gate_veto: boolean;
  sector: "public" | "private";
  level: keyof typeof EXPOSURE_WEIGHT.level | null;
  /** Points recoverable from defects in the gate ring vs the whole zone. */
  gate_points_recoverable: number;
  total_points_recoverable: number;
};

export type Priority = {
  /** 0–100, higher means intervene sooner. Null when the school is unscored. */
  rank_score: number | null;
  deficit: number | null;
  exposure: number;
  /** Share of the recoverable points that sit in the cheap gate ring, 0–1. */
  tractability: number;
  reason: string;
};

/**
 * Rank a school for intervention. Deliberately NOT the safety score: the worst
 * school is not automatically the best place to spend, and Purdy's question is
 * where money goes furthest.
 *
 *   deficit       how far below the legal floor the walk is
 *   exposure      how many children, and how vulnerable (proxy — see above)
 *   tractability  how much of the fix sits in the 150 m gate ring, where a
 *                 crossing or a ramp is a weekend of work rather than a
 *                 corridor rebuild
 *
 * An unscored school gets a null rank rather than a zero. Ranking a school last
 * because nobody has surveyed it would invert the actual priority, which is to
 * go and survey it.
 */
export function computePriority(input: PriorityInput): Priority {
  const exposure =
    EXPOSURE_WEIGHT.sector[input.sector] *
    EXPOSURE_WEIGHT.level[input.level ?? "unknown"];

  if (input.score === null) {
    return {
      rank_score: null,
      deficit: null,
      exposure: Number(exposure.toFixed(2)),
      tractability: 0,
      reason: "unscored",
    };
  }

  const deficit = Math.max(0, 100 - input.score);
  const tractability =
    input.total_points_recoverable > 0
      ? input.gate_points_recoverable / input.total_points_recoverable
      : 0;

  // Tractability lifts rather than gates: a school whose problems are all
  // corridor-shaped still needs fixing, it is just a bigger cheque. The 0.6
  // floor keeps it a thumb on the scale, not a veto.
  const rank =
    deficit * exposure * (0.6 + 0.4 * tractability) * (input.gate_veto ? 1.25 : 1);

  return {
    rank_score: Number(Math.min(100, rank).toFixed(1)),
    deficit: Number(deficit.toFixed(1)),
    exposure: Number(exposure.toFixed(2)),
    tractability: Number(tractability.toFixed(3)),
    reason: input.gate_veto
      ? "gate_veto"
      : tractability > 0.5
        ? "gate_fixable"
        : "corridor",
  };
}
