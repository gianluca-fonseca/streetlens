/**
 * Orchestrate one guided dialogue turn for a capture segment.
 *
 * Builds synthesis frames + rollup + spatial block fresh, calls converse or
 * recompute, persists chat messages, and on recompute writes the assessment
 * (EN+ES) + folds token spend into the synthesis ledger.
 */

import {
  createOpenAiSynthesisClient,
  type SynthesisFrame,
  type SynthesisClient,
} from "@/lib/extraction/synthesis";
import {
  runConverse,
  runRecompute,
  mergeGuidedScoresIntoManual,
  type DialogueProvenance,
} from "@/lib/extraction/guided-dialogue";
import type { DialogueTurn } from "@/lib/extraction/guided-context";
import { referencedSeqs } from "@/lib/extraction/guided-frame-refs";
import { extractionEnabled } from "@/lib/extraction/config";
import type { CaptureDb } from "./db";
import {
  recomputeReview,
  type CorrectableFrame,
  type ReviewCorrections,
  type SegmentAssessments,
} from "./review-overrides";
import type { SessionReview } from "./review-store";
import type { SegmentAssessment, SegmentAssessmentEs } from "./schemas";
import type { LensKey, LensScores } from "./scoring";
import {
  appendReviewDialogue,
  listReviewDialogues,
  type ReviewDialogueMessage,
} from "./dialogue-store";
import {
  buildDialogueSpatial,
  type SegmentGeometryMeta,
} from "./dialogue-spatial";
import type { MatchSegment } from "@/lib/matching/types";

export type DialogueMode = "converse" | "recompute";

export type RunDialogueArgs = {
  db: CaptureDb | null;
  review: SessionReview;
  segmentId: string;
  message: string;
  mode: DialogueMode;
  corrections: ReviewCorrections;
  /** Optional: inject client for tests. */
  client?: SynthesisClient;
  segmentMeta?: SegmentGeometryMeta | null;
  network?: MatchSegment[];
  nameById?: Map<string, string>;
};

export type RunDialogueResult = {
  mode: DialogueMode;
  assistantMessage: string;
  suggestRecompute: boolean;
  clarifyingQuestion: string;
  messages: ReviewDialogueMessage[];
  assessment?: SegmentAssessment;
  assessmentEs?: SegmentAssessmentEs | null;
  /** Manual score patch for this segment (recompute only). */
  manualScores?: Partial<Record<LensKey, number | null>>;
  provenance?: DialogueProvenance;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  referencedSeqs: number[];
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

function messagesToTranscript(rows: ReviewDialogueMessage[]): DialogueTurn[] {
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    recompute: r.recompute,
  }));
}

/**
 * Run one dialogue turn. Persists reviewer + assistant messages.
 * On recompute, also persists the new assessment and returns manual score patch.
 */
export async function runSegmentDialogue(args: RunDialogueArgs): Promise<RunDialogueResult> {
  if (!extractionEnabled()) {
    throw new Error("extraction_disabled");
  }

  const message = args.message.trim();
  if (!message) throw new Error("empty_message");

  const { review, segmentId, corrections, mode } = args;
  const assessments: SegmentAssessments = review.assessments ?? {};
  const correctable = toCorrectableFrames(review);
  const { segments } = recomputeReview(correctable, corrections, assessments);
  const seg = segments.find((s) => s.segmentId === segmentId);
  if (!seg) throw new Error("segment_not_found");

  const frames = buildSynthesisFrames(review, segmentId, corrections);
  if (frames.length === 0) throw new Error("no_frames_for_dialogue");

  const knownSeqs = frames.map((f) => f.seq);
  const refs = referencedSeqs(message, knownSeqs);

  const prior = await listReviewDialogues(review.sessionId, segmentId);
  const transcript = messagesToTranscript(prior);

  const spatial = buildDialogueSpatial({
    segmentId,
    review,
    segment: args.segmentMeta ?? null,
    network: args.network ?? [],
    nameById: args.nameById,
    referencedSeqs: refs,
  });

  const assessmentEs = review.assessmentsEs?.[segmentId] ?? null;
  const rollup = {
    segmentId,
    baselineScores: seg.baselineScores,
    currentScores: seg.scores,
    itemMedians: seg.itemMedians,
    assessment: assessments[segmentId] ?? seg.assessment,
    assessmentEs,
    coverage: seg.coverage,
    confidence: seg.confidence,
  };

  const client = args.client ?? createOpenAiSynthesisClient();
  const callArgs = {
    rollup,
    spatial,
    frames,
    transcript: [...transcript, { role: "reviewer" as const, content: message }],
    latestUserMessage: message,
    client,
  };

  await appendReviewDialogue({
    sessionId: review.sessionId,
    segmentId,
    role: "reviewer",
    content: message,
    recompute: mode === "recompute",
  });

  if (mode === "converse") {
    const outcome = await runConverse(callArgs);
    if (outcome.kind !== "ok") {
      await appendReviewDialogue({
        sessionId: review.sessionId,
        segmentId,
        role: "assistant",
        content: `[error] ${outcome.reason}`,
        recompute: false,
      });
      throw new Error(`converse_failed: ${outcome.reason}`);
    }

    const replyText = outcome.reply.clarifying_question
      ? `${outcome.reply.reply}\n\n${outcome.reply.clarifying_question}`
      : outcome.reply.reply;

    await appendReviewDialogue({
      sessionId: review.sessionId,
      segmentId,
      role: "assistant",
      content: replyText,
      recompute: false,
    });

    // Converse does not rewrite the assessment; token spend is returned in the
    // response for ops visibility. Recompute (below) folds usage into the
    // synthesis ledger via setSegmentAssessment (same seam as re-run analysis).

    const messages = await listReviewDialogues(review.sessionId, segmentId);
    return {
      mode,
      assistantMessage: replyText,
      suggestRecompute: outcome.reply.suggest_recompute,
      clarifyingQuestion: outcome.reply.clarifying_question ?? "",
      messages,
      usage: {
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      },
      model: outcome.model,
      referencedSeqs: refs,
    };
  }

  // RECOMPUTE
  const outcome = await runRecompute(callArgs);
  if (outcome.kind !== "ok") {
    await appendReviewDialogue({
      sessionId: review.sessionId,
      segmentId,
      role: "assistant",
      content: `[error] ${outcome.reason}`,
      recompute: true,
    });
    throw new Error(`recompute_failed: ${outcome.reason}`);
  }

  const summary = [
    `Recomputed assessment.`,
    outcome.assessment.overall.slice(0, 280),
    Object.entries(outcome.assessment.adjustments ?? {})
      .map(([k, v]) => (v ? `${k}: Δ${v.delta} — ${v.reason}` : null))
      .filter(Boolean)
      .join("; "),
  ]
    .filter(Boolean)
    .join("\n");

  await appendReviewDialogue({
    sessionId: review.sessionId,
    segmentId,
    role: "assistant",
    content: summary,
    recompute: true,
  });

  if (args.db) {
    await args.db.setSegmentAssessment({
      sessionId: review.sessionId,
      segmentId,
      assessment: outcome.assessment,
      assessmentEs: outcome.assessmentEs,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    });
  }

  const manualScores = mergeGuidedScoresIntoManual(
    segmentId,
    outcome.assessment.adjustedScores as LensScores,
    corrections.manualScores[segmentId] ?? {},
  );

  const messages = await listReviewDialogues(review.sessionId, segmentId);
  return {
    mode,
    assistantMessage: summary,
    suggestRecompute: false,
    clarifyingQuestion: "",
    messages,
    assessment: outcome.assessment,
    assessmentEs: outcome.assessmentEs,
    manualScores,
    provenance: outcome.provenance,
    usage: {
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    },
    model: outcome.model,
    referencedSeqs: refs,
  };
}
