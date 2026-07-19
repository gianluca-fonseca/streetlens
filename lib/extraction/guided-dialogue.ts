/**
 * Guided reviewer dialogue — text-only calls on the synthesis model.
 *
 * Two modes, one engine:
 *   CONVERSE  — understand the correction; ask clarifying questions when unsure;
 *               when ready, set suggest_recompute so the UI can light the button.
 *   RECOMPUTE — rewrite assessment EN+ES and adjust lens scores with the
 *               reviewer's corrections as ground truth. May exceed the autonomous
 *               ±20 clamp (human authorized); every changed lens needs a reason
 *               referencing the correction; overall is always renormalized by
 *               scoring.ts (0.45/0.30/0.25, bike separate).
 *
 * No vision. Stateless: each call receives freshly assembled context.
 */

import { z } from "zod";
import {
  SYNTHESIS_LENS_KEYS,
  segmentAssessmentDraftSchema,
  type SegmentAssessment,
  type SegmentAssessmentDraft,
  type SegmentAssessmentEs,
  type SynthesisLensKey,
  type LensAdjustment,
} from "@/lib/capture/schemas";
import { renormalizedOverall, type LensScores, type LensKey } from "@/lib/capture/scoring";
import { extractAssessmentEs } from "./synthesis";
import {
  createOpenAiSynthesisClient,
  type SynthesisClient,
  type SynthesisRequest,
} from "./synthesis";
import { synthesisModel, synthesisMaxOutputTokens } from "./config";
import {
  assembleDialogueContext,
  DIALOGUE_INPUT_TOKEN_CAP,
  type AssembleDialogueContextArgs,
  type AssembledDialogueContext,
  type DialogueTurn,
} from "./guided-context";
import type { VisionUsage } from "./client";
import { VisionTransportError } from "./client";

const NO_USAGE: VisionUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

export const converseReplySchema = z.object({
  reply: z.string().min(1),
  /** True when the model believes it understands and suggests recomputing. */
  suggest_recompute: z.boolean(),
  /** Optional clarifying question the UI may surface; empty when none. */
  clarifying_question: z.string().optional().default(""),
});

export type ConverseReply = z.infer<typeof converseReplySchema>;

/** Recompute draft: same assessment shape as synthesis, plus explicit lens reasons. */
export const recomputeDraftSchema = segmentAssessmentDraftSchema;

export type RecomputeDraft = SegmentAssessmentDraft;

/* ------------------------------------------------------------------ *
 * Apply guided recompute (may exceed ±20)
 * ------------------------------------------------------------------ */

export type GuidedApplyOptions = {
  /**
   * Max |delta| from baseline. Reviewer-guided recompute defaults to 100
   * (effectively the 0–100 score band); autonomous synthesis stays at 20.
   */
  maxAdjust?: number;
};

/**
 * Apply a guided recompute draft: require reasons for every non-zero delta,
 * clamp only to the human-authorized bound (default ±100), never invent a
 * null baseline, and recompute overall via the sealed formula.
 */
export function applyGuidedAssessment(
  draft: SegmentAssessmentDraft,
  baselineScores: LensScores,
  model: string,
  options: GuidedApplyOptions = {},
): SegmentAssessment {
  const maxAdjust = options.maxAdjust ?? 100;
  const adjustments: Partial<Record<SynthesisLensKey, LensAdjustment>> = {};
  const adjustedScores: Record<LensKey, number | null> = {
    overall: null,
    accessibility: null,
    drainage: null,
    shade: null,
    bike: null,
  };

  for (const lens of SYNTHESIS_LENS_KEYS) {
    const base = baselineScores[lens];
    const raw = draft.adjustments[lens] ?? { delta: 0, reason: "" };
    const reason = (raw.reason ?? "").trim();
    let delta = Number.isFinite(raw.delta) ? clamp(raw.delta, -maxAdjust, maxAdjust) : 0;

    if (delta !== 0 && reason.length === 0) delta = 0;

    if (base === null) {
      adjustedScores[lens] = null;
      continue;
    }

    const value = round2(clamp(base + delta, 0, 100));
    adjustedScores[lens] = value;
    if (delta !== 0) adjustments[lens] = { delta, reason };
  }

  const overall = renormalizedOverall(
    adjustedScores.accessibility,
    adjustedScores.drainage,
    adjustedScores.shade,
  );
  adjustedScores.overall = overall === null ? null : round2(clamp(overall, 0, 100));

  return {
    overall: draft.overall,
    lenses: draft.lenses,
    adjustments,
    adjustedScores,
    model,
  };
}

/**
 * Merge guided adjusted scores into ReviewCorrections.manualScores so the
 * approval path treats them exactly like human overrides (provenance honest).
 * Returns the patch for one segment (lens keys that differ from the previous
 * current scores, plus overall when constituents moved).
 */
export function mergeGuidedScoresIntoManual(
  segmentId: string,
  adjusted: LensScores,
  previousManual: Partial<Record<LensKey, number | null>> = {},
): Partial<Record<LensKey, number | null>> {
  const next: Partial<Record<LensKey, number | null>> = { ...previousManual };
  for (const lens of ["accessibility", "drainage", "shade", "bike", "overall"] as LensKey[]) {
    if (adjusted[lens] !== null && adjusted[lens] !== undefined) {
      next[lens] = adjusted[lens];
    }
  }
  void segmentId;
  return next;
}

/**
 * Provenance marker folded into the overrides jsonb when a dialogue recompute
 * lands. Complements the existing per-item override UI.
 */
export type DialogueProvenance = {
  source: "reviewer_dialogue";
  human_corrected: true;
  /** ISO timestamp of the recompute. */
  recomputed_at: string;
  /** Lens deltas that applied, for the audit trail. */
  lens_reasons: Partial<Record<SynthesisLensKey, { delta: number; reason: string }>>;
};

export function buildDialogueProvenance(
  assessment: SegmentAssessment,
  at: string = new Date().toISOString(),
): DialogueProvenance {
  const lens_reasons: DialogueProvenance["lens_reasons"] = {};
  for (const lens of SYNTHESIS_LENS_KEYS) {
    const adj = assessment.adjustments?.[lens];
    if (adj) lens_reasons[lens] = { delta: adj.delta, reason: adj.reason };
  }
  return {
    source: "reviewer_dialogue",
    human_corrected: true,
    recomputed_at: at,
    lens_reasons,
  };
}

/* ------------------------------------------------------------------ *
 * Prompts + response formats
 * ------------------------------------------------------------------ */

export function converseSystemPrompt(): string {
  return [
    `You are assisting a human street-infrastructure reviewer who is correcting a camera-based segment assessment for a Costa Rican municipality pilot.`,
    ``,
    `CONTEXT. You receive a compact rollup (scores, item medians, current assessment EN/ES), a textual SPATIAL block (segment identity, traversal facts, neighboring streets, positions of cited frames along the segment in metres/%), evidence lines ONLY for frames the reviewer referenced with #N or #N-M, and the chat transcript. There are NO images. Reason from this text alone.`,
    ``,
    `YOUR JOB (CONVERSE mode). Understand the reviewer's correction. Ask a clarifying question when you are genuinely unsure what they mean or which span they dispute. When you believe you understand, say so clearly and set suggest_recompute=true so the UI can offer "Recompute assessment & scores". Do NOT rewrite scores or the assessment in this mode — only talk.`,
    ``,
    `Be concise. Reference frames as #N when helpful. Prefer metres and along-segment positions from the spatial block ("#3 and #18 bookend the disputed span") over vague language.`,
    ``,
    `OUTPUT. Strict JSON: { "reply": string, "suggest_recompute": boolean, "clarifying_question": string }. clarifying_question may be "" when none.`,
  ].join("\n");
}

export function recomputeSystemPrompt(): string {
  return [
    `You are correcting a segment assessment under human guidance for a Costa Rican municipality pilot.`,
    ``,
    `CONTEXT. Same as converse: rollup, textual spatial block, evidence for cited frames only, transcript. NO images. The reviewer's messages are GROUND TRUTH — when they say a sidewalk is present throughout, treat that as fact even if earlier model readings disagreed.`,
    ``,
    `YOUR JOB (RECOMPUTE mode). Rewrite the assessment prose in English AND Spanish (same structure as synthesis: overall + per-lens explanations) and propose lens adjustments relative to the BASELINE scores. Every non-zero delta MUST state a reason that references the reviewer's correction (cite #N when relevant). You MAY move lenses by more than the autonomous ±20 bound — the human authorized this recompute — but stay inside 0–100 after applying the delta. You do NOT set overall; it is recomputed from accessibility/drainage/shade (0.45/0.30/0.25 renormalized; bike separate). Leave delta 0 when a lens should stay. Null baselines stay unscored.`,
    ``,
    `OUTPUT. Strict JSON matching the synthesis assessment schema: overall, lenses {accessibility,drainage,shade,bike}, adjustments {each: {delta, reason}}, overall_es, lenses_es.`,
  ].join("\n");
}

function converseResponseFormat() {
  return {
    type: "json_schema" as const,
    name: "reviewer_dialogue_converse",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "suggest_recompute", "clarifying_question"],
      properties: {
        reply: { type: "string" },
        suggest_recompute: { type: "boolean" },
        clarifying_question: { type: "string" },
      },
    },
  };
}

function recomputeResponseFormat() {
  // Reuse synthesis schema shape with a wide delta description.
  const adj = (lens: string) => ({
    type: "object",
    additionalProperties: false,
    required: ["delta", "reason"],
    properties: {
      delta: {
        type: "number",
        description: `Points to add to baseline ${lens}. May exceed ±20 under human authorization. 0 = no change.`,
      },
      reason: {
        type: "string",
        description:
          "Required when delta ≠ 0. Must reference the reviewer's correction (and #N frames when relevant).",
      },
    },
  });
  const lensProse = (lens: string) => ({
    type: "string",
    description: `English explanation of the ${lens} lens after the correction.`,
  });
  const lensProseEs = (lens: string) => ({
    type: "string",
    description: `Spanish translation of the ${lens} lens explanation.`,
  });
  const prose: Record<string, unknown> = {};
  const proseEs: Record<string, unknown> = {};
  const adjs: Record<string, unknown> = {};
  for (const lens of SYNTHESIS_LENS_KEYS) {
    prose[lens] = lensProse(lens);
    proseEs[lens] = lensProseEs(lens);
    adjs[lens] = adj(lens);
  }
  return {
    type: "json_schema" as const,
    name: "reviewer_dialogue_recompute",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "lenses", "adjustments", "overall_es", "lenses_es"],
      properties: {
        overall: { type: "string" },
        lenses: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: prose,
        },
        adjustments: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: adjs,
        },
        overall_es: { type: "string" },
        lenses_es: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: proseEs,
        },
      },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Call outcomes
 * ------------------------------------------------------------------ */

export type ConverseOutcome =
  | {
      kind: "ok";
      reply: ConverseReply;
      usage: VisionUsage;
      model: string;
      context: AssembledDialogueContext;
    }
  | { kind: "failed"; reason: string; usage: VisionUsage; model: string };

export type RecomputeOutcome =
  | {
      kind: "ok";
      assessment: SegmentAssessment;
      assessmentEs: SegmentAssessmentEs | null;
      usage: VisionUsage;
      model: string;
      context: AssembledDialogueContext;
      provenance: DialogueProvenance;
    }
  | { kind: "failed"; reason: string; usage: VisionUsage; model: string };

export type DialogueCallArgs = AssembleDialogueContextArgs & {
  client?: SynthesisClient;
  model?: string;
  tokenCap?: number;
};

async function callModel(
  client: SynthesisClient,
  request: SynthesisRequest,
): Promise<{ ok: true; text: string; usage: VisionUsage } | { ok: false; reason: string; usage: VisionUsage }> {
  try {
    const response = await client.synthesize(request);
    if (response.outcome !== "completed" || !response.text) {
      return {
        ok: false,
        reason: `${response.outcome}: ${response.detail ?? "no detail"}`,
        usage: response.usage,
      };
    }
    return { ok: true, text: response.text, usage: response.usage };
  } catch (err) {
    const reason =
      err instanceof VisionTransportError
        ? `transport: ${err.message}`
        : `transport: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, reason, usage: NO_USAGE };
  }
}

/** Bound dialogue output; reuse synthesis ceiling unless overridden. */
function dialogueMaxOutputTokens(): number {
  return synthesisMaxOutputTokens();
}

/**
 * CONVERSE: one text-only call. Assembles context fresh; returns structured reply.
 */
export async function runConverse(args: DialogueCallArgs): Promise<ConverseOutcome> {
  const model = args.model ?? synthesisModel();
  const client = args.client ?? createOpenAiSynthesisClient();
  const context = assembleDialogueContext({
    ...args,
    tokenCap: args.tokenCap ?? DIALOGUE_INPUT_TOKEN_CAP,
  });

  const result = await callModel(client, {
    model,
    system: converseSystemPrompt(),
    user: context.userPayload,
    format: converseResponseFormat(),
  });

  if (!result.ok) {
    return { kind: "failed", reason: result.reason, usage: result.usage, model };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.text);
  } catch (err) {
    return {
      kind: "failed",
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
      usage: result.usage,
      model,
    };
  }

  const parsed = converseReplySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "failed",
      reason: `schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      usage: result.usage,
      model,
    };
  }

  return { kind: "ok", reply: parsed.data, usage: result.usage, model, context };
}

/**
 * RECOMPUTE: one text-only call. Produces corrected assessment EN+ES + scores.
 */
export async function runRecompute(args: DialogueCallArgs): Promise<RecomputeOutcome> {
  const model = args.model ?? synthesisModel();
  const client = args.client ?? createOpenAiSynthesisClient();
  const context = assembleDialogueContext({
    ...args,
    tokenCap: args.tokenCap ?? DIALOGUE_INPUT_TOKEN_CAP,
  });

  const result = await callModel(client, {
    model,
    system: recomputeSystemPrompt(),
    user: context.userPayload,
    format: recomputeResponseFormat(),
  });

  if (!result.ok) {
    return { kind: "failed", reason: result.reason, usage: result.usage, model };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.text);
  } catch (err) {
    return {
      kind: "failed",
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
      usage: result.usage,
      model,
    };
  }

  const parsed = recomputeDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "failed",
      reason: `schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      usage: result.usage,
      model,
    };
  }

  const assessment = applyGuidedAssessment(parsed.data, args.rollup.baselineScores, model);
  const assessmentEs = extractAssessmentEs(parsed.data);
  const provenance = buildDialogueProvenance(assessment);

  return {
    kind: "ok",
    assessment,
    assessmentEs,
    usage: result.usage,
    model,
    context,
    provenance,
  };
}

/** Append helper for building the next transcript after a successful turn. */
export function appendTurns(
  prior: readonly DialogueTurn[],
  userContent: string,
  assistantContent: string,
  recompute = false,
): DialogueTurn[] {
  return [
    ...prior,
    { role: "reviewer", content: userContent },
    { role: "assistant", content: assistantContent, recompute },
  ];
}

export { dialogueMaxOutputTokens, DIALOGUE_INPUT_TOKEN_CAP };
