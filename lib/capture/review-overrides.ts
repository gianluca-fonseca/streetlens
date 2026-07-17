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
};

export const EMPTY_CORRECTIONS: ReviewCorrections = {
  itemOverrides: {},
  excluded: [],
  deleted: [],
  manualScores: {},
};

/** One segment after correction, ready for the approve payload and the UI. */
export type RecomputedSegment = {
  segmentId: string;
  scores: LensScores;
  itemMedians: Record<string, ItemMedian>;
  coverage: number;
  confidence: number | null;
  /** Storage paths of the frames that still feed this segment (not excluded/deleted). */
  frameRefs: string[];
  /** True when a reviewer touched this segment: an override, an exclusion, or a manual score. */
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
};

export type RecomputeResult = {
  /** Surviving segments, sorted by id (computeRollups' order). */
  segments: RecomputedSegment[];
  /** Segments that had frames but lost every one to exclusion/deletion. Not approvable. */
  droppedSegmentIds: string[];
};

/** A confidence a human override asserts: the reviewer is certain, so it dominates. */
const OVERRIDE_CONFIDENCE = 1;

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
    const manual = corrections.manualScores[r.segmentId] ?? {};
    const scores: LensScores = { ...r.scores };
    let manualEdited = false;
    for (const lens of LENS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(manual, lens)) {
        scores[lens] = manual[lens] ?? null;
        manualEdited = true;
      }
    }

    const overrides = buildSegmentOverrideRecord(r.segmentId, frames, corrections);
    const humanCorrected =
      manualEdited ||
      overrides.excludedSeqs.length > 0 ||
      overrides.deletedSeqs.length > 0 ||
      Object.keys(overrides.items).length > 0;

    return {
      segmentId: r.segmentId,
      scores,
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

  return { items, excludedSeqs, deletedSeqs, scores };
}
