/**
 * Reviewer corrections → recomputed segment rollups.
 *
 * WHY THIS EXISTS, and why it is one pure function:
 *
 * A reviewer can correct a camera walk before approving it — override an item's
 * value on a frame, exclude a frame from scoring, hard-delete a frame for privacy,
 * and finally nudge a segment's lens scores by hand. The seed (u2, seal #2 and
 * addendum #4) demands one thing above all: the recompute uses the SAME rollup math
 * the server used to produce the numbers in the first place. So this module never
 * reimplements a median, a normalization, or a lens weight. It orchestrates —
 * dropping frames and swapping item values — then hands the result to the real
 * `computeRollups` (lib/capture/rollup.ts), and only afterward lets a manual score
 * edit win.
 *
 * The composition order is a contract (addendum #4):
 *   drop deleted → drop excluded → apply item overrides → computeRollups
 *   → manual score edits win → drop segments with zero contributing frames.
 *
 * Pure: frames + corrections in, recomputed segments out. No I/O, no clock. It runs
 * client-side for the live preview and server-side as the authoritative persist, so
 * the numbers a reviewer sees are byte-identical to the numbers that land.
 */

import { computeRollups, type RollupObservation, type ItemMedian } from "./rollup";
import { LENS_KEYS, type LensKey, type LensScores } from "./scoring";
import type { RubricItemKey, CaptureObservationItem } from "./types";

/**
 * One frame's model reading, the frozen cross-lane contract (u2 seed, seal #1).
 *
 * A sibling lane surfaces this on `capture_session_review` frames server-side; we
 * consume it verbatim and code the inspector/recompute against the fixture until it
 * lands. `null` means the frame produced no reading (never extracted, or the money
 * ran out) — distinct from a reading whose every item is "not assessable".
 *
 * Defined here, not in review-store, so this pure module never drags in the read
 * model's I/O imports (supabase, storage); review-store re-exports it.
 */
export type FrameObservation = {
  items: Record<RubricItemKey, CaptureObservationItem>;
  /** The model's free-text reasoning for this frame, when it gave one. */
  rationale: string | null;
  escalated: boolean;
  model: string;
};

/**
 * The segment synthesis, the frozen cross-lane contract (u2 seed, seal #1).
 *
 * A sibling lane's engine writes one of these per rollup entry on
 * `capture_session_review` (its migration 0022); we consume it verbatim and code
 * the workbench/recompute against a fixture until it lands. `null` (an absent
 * entry) means no synthesis was produced — the workbench renders an honest
 * "no assessment available" state.
 *
 * The synthesis is CONTEXT, never the number of record. Its per-lens `delta` is
 * re-applied to the reviewer's freshly recomputed baseline (seal #2), so the
 * `adjustedScores` here are the engine's own proposal on the ORIGINAL frames and
 * are shown only for reference; the number that lands is recomputed, not read
 * from this object.
 */
export type AssessmentAdjustment = {
  /** Bounded nudge the engine proposes for this lens, in score points (may be negative). */
  delta: number;
  /** The engine's free-text justification for the nudge. */
  reason: string;
};

export type SegmentAssessment = {
  /** The overall, plain-language verdict a reviewer reads first. Model output, English. */
  overall: string;
  /** Per-lens explanations (the composite `overall` lens has no separate explanation). */
  lenses: {
    accessibility: string;
    drainage: string;
    shade: string;
    bike: string;
  };
  /** Per-lens bounded adjustments the engine proposes, keyed by lens. */
  adjustments: Partial<Record<LensKey, AssessmentAdjustment>>;
  /** The engine's adjusted scores on the ORIGINAL baseline. Reference only; recomputed on the fresh baseline. */
  adjustedScores: LensScores;
  /** The model that produced the synthesis. */
  model: string;
};

/** Per-segment synthesis, keyed by segment id. A missing/null entry means "no assessment". */
export type SegmentAssessments = Record<string, SegmentAssessment | null>;

/**
 * The minimal frame shape the recompute needs. The read model's richer
 * `ReviewFrame` (with url/position) is structurally a superset and passes straight in.
 */
export type CorrectableFrame = {
  seq: number;
  storagePath: string;
  segmentId: string | null;
  nearJunction: boolean;
  usable: boolean;
  observation: FrameObservation | null;
  /** A tombstone: bytes hard-deleted for privacy. A deleted frame never scores. */
  deleted: boolean;
};

/**
 * What a reviewer changed. Compact by construction: only the deltas, keyed so the
 * same record round-trips through the approve payload and into the `overrides`
 * jsonb column for an auditable map record.
 */
export type ReviewCorrections = {
  /** Per frame seq, the item values the reviewer replaced (null = "not assessable"). */
  itemOverrides: Record<number, Partial<Record<RubricItemKey, number | null>>>;
  /** Frame seqs excluded from scoring (reversible). */
  excluded: number[];
  /** Frame seqs whose bytes were hard-deleted (irreversible). Implies exclusion. */
  deleted: number[];
  /** Per segment, lens scores the reviewer set by hand. These win over the recompute. */
  manualScores: Record<string, Partial<Record<LensKey, number | null>>>;
  /**
   * Per segment, the lenses where the reviewer tapped "use baseline" to decline the
   * synthesis adjustment. The adjusted score is the DEFAULT proposal (seal #2), so
   * an unlisted lens keeps its adjustment; a listed one reverts to the recomputed
   * baseline. A manual score still wins over either.
   */
  baselineLenses: Record<string, LensKey[]>;
};

export const EMPTY_CORRECTIONS: ReviewCorrections = {
  itemOverrides: {},
  excluded: [],
  deleted: [],
  manualScores: {},
  baselineLenses: {},
};

/** One segment after correction, ready for the approve payload and the UI. */
export type RecomputedSegment = {
  segmentId: string;
  /** The numbers that LAND: the synthesis-adjusted baseline, with baseline opt-outs and manual edits applied. */
  scores: LensScores;
  /** The pure recomputed rollup, before any synthesis adjustment or manual edit. Shown beside the adjusted values. */
  baselineScores: LensScores;
  /** The baseline with each proposed adjustment's clamped delta applied. The default proposal, before opt-outs/manual. */
  adjustedScores: LensScores;
  /** The synthesis for this segment, or null when none was produced. */
  assessment: SegmentAssessment | null;
  /**
   * True when the reviewer excluded/deleted frames or overrode items on this
   * segment, so the recomputed baseline no longer matches the frames the synthesis
   * text was written about. The explanation gets a "written before your corrections"
   * hint; the DELTAS still apply to the fresh baseline (seal #2).
   */
  assessmentStale: boolean;
  itemMedians: Record<string, ItemMedian>;
  coverage: number;
  confidence: number | null;
  /** Storage paths of the frames that still feed this segment (not excluded/deleted). */
  frameRefs: string[];
  /** True when a reviewer touched this segment: an override, an exclusion, a manual score, or a baseline opt-out. */
  humanCorrected: boolean;
  /** The compact per-segment record of what changed, for the `overrides` jsonb. */
  overrides: SegmentOverrideRecord;
  /** True when a manual score edit was applied over the recompute. */
  manualEdited: boolean;
};

/** The per-segment audit record persisted in `community_cv_observations.overrides`. */
export type SegmentOverrideRecord = {
  items: Record<number, Partial<Record<RubricItemKey, number | null>>>;
  excludedSeqs: number[];
  deletedSeqs: number[];
  scores: Partial<Record<LensKey, number | null>>;
  /** Lenses where the reviewer declined the synthesis adjustment. Omitted when none. */
  baselineLenses?: LensKey[];
};

export type RecomputeResult = {
  /** Surviving segments, sorted by id (computeRollups' order). */
  segments: RecomputedSegment[];
  /** Segments that had frames but lost every one to exclusion/deletion. Not approvable. */
  droppedSegmentIds: string[];
};

/** A confidence a human override asserts: the reviewer is certain, so it dominates. */
const OVERRIDE_CONFIDENCE = 1;

/** Keep an adjusted score inside the 0-100 band and to two decimals, like the rollup. */
function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

/**
 * The baseline with each proposed lens delta applied, clamped to 0-100.
 *
 * The delta rides the FRESH baseline, not the engine's `adjustedScores` (seal #2):
 * after a reviewer excludes or overrides frames the baseline moves, and the honest
 * adjusted value is that moved baseline plus the same delta. A lens the frames
 * never measured (null baseline) cannot be adjusted — unknown is not a number to
 * nudge — so it stays null.
 */
function computeAdjusted(
  baseline: LensScores,
  assessment: SegmentAssessment | null,
): LensScores {
  const out: LensScores = { ...baseline };
  if (!assessment) return out;
  for (const lens of LENS_KEYS) {
    const adj = assessment.adjustments?.[lens];
    const base = baseline[lens];
    if (adj && typeof adj.delta === "number" && Number.isFinite(adj.delta) && base !== null) {
      out[lens] = clampScore(base + adj.delta);
    }
  }
  return out;
}

function isDeleted(frame: CorrectableFrame, corrections: ReviewCorrections): boolean {
  return frame.deleted || corrections.deleted.includes(frame.seq);
}

/** Apply a frame's item overrides onto the model's readings, minting new items. */
function applyItemOverrides(
  items: Record<RubricItemKey, CaptureObservationItem>,
  overrides: Partial<Record<RubricItemKey, number | null>> | undefined,
): Record<RubricItemKey, CaptureObservationItem> {
  if (!overrides) return items;
  const next: Record<string, CaptureObservationItem> = { ...items };
  for (const [key, value] of Object.entries(overrides)) {
    // A human override is an assertion, not a guess: it carries full confidence so
    // it actually participates in (and dominates) the confidence-weighted median.
    // A null override means "not assessable" and drops out, exactly like a model null.
    next[key] = { value: value ?? null, confidence: OVERRIDE_CONFIDENCE };
  }
  return next as Record<RubricItemKey, CaptureObservationItem>;
}

/**
 * Recompute every segment from the surviving frames and the reviewer's corrections.
 *
 * The heart of the override model. See the file header for the composition order.
 */
export function recomputeReview(
  frames: readonly CorrectableFrame[],
  corrections: ReviewCorrections,
  assessments: SegmentAssessments = {},
): RecomputeResult {
  const excluded = new Set(corrections.excluded);

  // Which segments even had a frame to begin with — the universe that can "drop".
  // A segment truly disappears only when computeRollups emits nothing for it (below);
  // one that keeps a single surviving frame stays, even at zero coverage.
  const segmentsWithFrames = new Set<string>();
  for (const f of frames) {
    if (f.segmentId) segmentsWithFrames.add(f.segmentId);
  }

  // Build the rollup input: drop deleted, drop excluded, drop frames with no reading,
  // then apply item overrides. Frames keep their storagePath so we can list frameRefs.
  const surviving: { obs: RollupObservation; storagePath: string }[] = [];
  for (const f of frames) {
    if (isDeleted(f, corrections)) continue;
    if (excluded.has(f.seq)) continue;
    if (!f.observation) continue; // no reading ⇒ never in the rollup, exactly like the pump
    surviving.push({
      obs: {
        frameId: String(f.seq),
        segmentId: f.segmentId,
        model: f.observation.model,
        items: applyItemOverrides(f.observation.items, corrections.itemOverrides[f.seq]),
        usable: f.usable,
        escalated: f.observation.escalated,
        nearJunction: f.nearJunction,
      },
      storagePath: f.storagePath,
    });
  }

  const rollups = computeRollups(surviving.map((s) => s.obs));

  // frameRefs per segment: the attributed, surviving frames (mirrors the review route,
  // which listed every attributed frame's storagePath, usable or not).
  const refsBySegment = new Map<string, string[]>();
  for (const s of surviving) {
    if (!s.obs.segmentId) continue;
    const list = refsBySegment.get(s.obs.segmentId);
    if (list) list.push(s.storagePath);
    else refsBySegment.set(s.obs.segmentId, [s.storagePath]);
  }

  const survivingIds = new Set(rollups.map((r) => r.segmentId));
  const droppedSegmentIds = [...segmentsWithFrames]
    .filter((id) => !survivingIds.has(id))
    .sort((a, b) => a.localeCompare(b));

  const segments: RecomputedSegment[] = rollups.map((r) => {
    const assessment = assessments[r.segmentId] ?? null;
    const manual = corrections.manualScores[r.segmentId] ?? {};
    const useBaseline = new Set(corrections.baselineLenses[r.segmentId] ?? []);

    // Composition order (seal #2): the pure rollup baseline, then the synthesis
    // adjustment (the DEFAULT), then a per-lens baseline opt-out, then a manual edit
    // that wins over all of it.
    const baselineScores: LensScores = { ...r.scores };
    const adjustedScores = computeAdjusted(baselineScores, assessment);

    const scores: LensScores = { ...adjustedScores };
    for (const lens of LENS_KEYS) {
      if (useBaseline.has(lens)) scores[lens] = baselineScores[lens];
    }
    let manualEdited = false;
    for (const lens of LENS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(manual, lens)) {
        scores[lens] = manual[lens] ?? null;
        manualEdited = true;
      }
    }

    const overrides = buildSegmentOverrideRecord(r.segmentId, frames, corrections);
    // The synthesis text was written about the frames the model saw. If the reviewer
    // has since changed which frames or values feed the baseline, the explanation
    // predates that; the deltas still ride the fresh baseline, but the prose is stale.
    const assessmentStale =
      assessment !== null &&
      (overrides.excludedSeqs.length > 0 ||
        overrides.deletedSeqs.length > 0 ||
        Object.keys(overrides.items).length > 0);
    const humanCorrected =
      manualEdited ||
      overrides.excludedSeqs.length > 0 ||
      overrides.deletedSeqs.length > 0 ||
      Object.keys(overrides.items).length > 0 ||
      (overrides.baselineLenses?.length ?? 0) > 0;

    return {
      segmentId: r.segmentId,
      scores,
      baselineScores,
      adjustedScores,
      assessment,
      assessmentStale,
      itemMedians: r.itemMedians,
      coverage: r.coverage,
      confidence: r.confidence,
      frameRefs: refsBySegment.get(r.segmentId) ?? [],
      humanCorrected,
      overrides,
      manualEdited,
    };
  });

  return { segments, droppedSegmentIds };
}

/** Collect only the corrections that pertain to one segment, for its audit record. */
function buildSegmentOverrideRecord(
  segmentId: string,
  frames: readonly CorrectableFrame[],
  corrections: ReviewCorrections,
): SegmentOverrideRecord {
  const seqToSegment = new Map<number, string | null>();
  for (const f of frames) seqToSegment.set(f.seq, f.segmentId);

  const items: Record<number, Partial<Record<RubricItemKey, number | null>>> = {};
  for (const [seqStr, over] of Object.entries(corrections.itemOverrides)) {
    const seq = Number(seqStr);
    if (seqToSegment.get(seq) === segmentId && over && Object.keys(over).length > 0) {
      items[seq] = over;
    }
  }

  const excludedSeqs = corrections.excluded
    .filter((seq) => seqToSegment.get(seq) === segmentId)
    .sort((a, b) => a - b);
  const deletedSeqs = corrections.deleted
    .filter((seq) => seqToSegment.get(seq) === segmentId)
    .sort((a, b) => a - b);
  const scores = corrections.manualScores[segmentId] ?? {};
  const baselineLenses = (corrections.baselineLenses[segmentId] ?? []).filter(
    (lens): lens is LensKey => (LENS_KEYS as readonly string[]).includes(lens),
  );

  const record: SegmentOverrideRecord = { items, excludedSeqs, deletedSeqs, scores };
  // Only carry the field when the reviewer actually declined an adjustment, so an
  // untouched approval keeps its `{}`-shaped record byte-for-byte (0021 back-compat).
  if (baselineLenses.length > 0) record.baselineLenses = baselineLenses;
  return record;
}
