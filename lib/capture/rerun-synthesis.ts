/**
 * Re-run synthesis on a curated segment frame set (closes backlog #13).
 *
 * One synthesis call per segment, using the reviewer's corrected evidence and
 * freshly recomputed baseline scores. Token spend is recorded on the rollup.
 */

import { createOpenAiSynthesisClient, synthesizeSegment, type SynthesisFrame } from "@/lib/extraction/synthesis";
import { extractionEnabled } from "@/lib/extraction/config";
import type { CaptureDb } from "./db";
import {
  recomputeReview,
  type CorrectableFrame,
  type ReviewCorrections,
  type SegmentAssessments,
} from "./review-overrides";
import type { SegmentAssessment } from "./schemas";
import type { SessionReview } from "./review-store";

export type RerunSynthesisArgs = {
  db: CaptureDb;
  review: SessionReview;
  segmentId: string;
  corrections: ReviewCorrections;
};

export type RerunSynthesisResult = {
  assessment: SegmentAssessment;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

function toCorrectableFrames(review: SessionReview): CorrectableFrame[] {
  return review.frames.map((f) => ({
    seq: f.seq,
    storagePath: f.storagePath,
    segmentId: f.segmentId,
    nearJunction: f.nearJunction,
    usable: f.usable,
    observation: f.observation,
    deleted: f.deleted,
  }));
}

function buildSynthesisFrames(
  review: SessionReview,
  segmentId: string,
  corrections: ReviewCorrections,
): SynthesisFrame[] {
  const excluded = new Set(corrections.excluded);
  const deleted = new Set(corrections.deleted);
  const frames: SynthesisFrame[] = [];

  for (const f of review.frames) {
    if (f.deleted || deleted.has(f.seq)) continue;
    if (excluded.has(f.seq)) continue;
    if (f.segmentId !== segmentId) continue;
    if (!f.observation) continue;

    const overrides = corrections.itemOverrides[f.seq];
    let items = f.observation.items;
    if (overrides) {
      items = { ...items };
      for (const [key, value] of Object.entries(overrides)) {
        items[key as keyof typeof items] = {
          value: value ?? null,
          confidence: 1,
        };
      }
    }

    frames.push({
      seq: f.seq,
      location: f.position ?? null,
      nearJunction: f.nearJunction,
      usable: f.usable,
      items,
      rationale: f.observation.rationale,
    });
  }

  frames.sort((a, b) => a.seq - b.seq);
  return frames;
}

/**
 * Re-synthesize one segment after reviewer curation. Persists to the rollup row.
 */
export async function rerunSegmentSynthesis(
  args: RerunSynthesisArgs,
): Promise<RerunSynthesisResult> {
  if (!extractionEnabled()) {
    throw new Error("extraction_disabled");
  }

  const { db, review, segmentId, corrections } = args;
  const assessments: SegmentAssessments = review.assessments ?? {};
  const correctable = toCorrectableFrames(review);
  const { segments } = recomputeReview(correctable, corrections, assessments);
  const seg = segments.find((s) => s.segmentId === segmentId);
  if (!seg) {
    throw new Error("segment_not_found");
  }

  const frames = buildSynthesisFrames(review, segmentId, corrections);
  if (frames.length === 0) {
    throw new Error("no_frames_for_synthesis");
  }

  const rollup = review.segments.find((r) => r.segmentId === segmentId);
  const itemMedians = rollup?.itemMedians ?? seg.itemMedians;

  const synthesis = createOpenAiSynthesisClient();
  const outcome = await synthesizeSegment(synthesis, {
    segmentId,
    frames,
    baselineScores: seg.baselineScores,
    itemMedians,
  });

  if (outcome.kind !== "ok") {
    throw new Error(`synthesis_failed: ${outcome.reason}`);
  }

  await db.setSegmentAssessment({
    sessionId: review.sessionId,
    segmentId,
    assessment: outcome.assessment,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
  });

  return {
    assessment: outcome.assessment,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    model: outcome.model,
  };
}
