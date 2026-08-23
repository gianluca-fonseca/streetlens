/**
 * The written reading of a school zone — model-drafted, human-owned.
 *
 * ── WHAT THE MODEL IS AND IS NOT ALLOWED TO DO ─────────────────────────────
 * It does not score anything. Every number in the prompt is already decided by
 * lib/school-score.ts from the existing capture pipeline, and the model's only
 * job is to say in a paragraph what those numbers mean for a child walking to
 * this school. If a model could move a score, the score would no longer be
 * reproducible from the segments underneath it, and the whole defence of the
 * standard — "recompute it yourself" — would collapse.
 *
 * So the prompt carries the arithmetic as FACTS and asks for prose. The schema
 * has no numeric fields at all, which is the structural version of the same
 * rule: there is nowhere for a hallucinated figure to land.
 *
 * ── WHY IT IS EDITABLE, AND WHY EDITING RELABELS IT ────────────────────────
 * An assessment is the sentence a partner quotes, so a person has to be able to
 * fix it. The moment they do, `origin` flips to "human" and the surface stops
 * calling it model-written. A label that survives editing is a lie about
 * provenance, and provenance is the product.
 *
 * Text-only, so it does not go through lib/extraction/client.ts (which is built
 * for frames and carries the per-frame cost breaker). It reuses that module's
 * key and model configuration so there is still one place to change either.
 */

import { openaiApiKey, synthesisModel } from "./extraction/config";
import {
  LENS_WEIGHTS,
  LEY_7600_MIN_SCORE,
  SCHOOL_ZONE,
  type SchoolScore,
} from "./school-score";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export type DraftedAssessment = {
  overall: string;
  overall_es: string;
  findings: { text: string; segment_id?: string | null }[];
  model: string;
};

export type AssessmentInput = {
  school_name: string;
  sector: "public" | "private";
  level: string | null;
  district: string | null;
  score: SchoolScore;
  /** Metres of street in the zone nobody has recorded yet. */
  gap_length_m: number;
  gap_count: number;
};

const TIER_PROSE: Record<string, string> = {
  sin_datos: "not enough of the walk has been surveyed to publish a rating",
  critico: "critical",
  en_riesgo: "at risk",
  en_progreso: "improving",
  escuela_segura: "meets the Escuela Segura standard",
};

/**
 * The evidence block. Written as flat statements rather than JSON because the
 * model reads it better as prose, and because anything ambiguous here comes
 * back as a hedge in the paragraph.
 */
export function buildAssessmentEvidence(input: AssessmentInput): string {
  const s = input.score;
  const lines: string[] = [];

  lines.push(`School: ${input.school_name}`);
  lines.push(
    `Sector: ${input.sector === "public" ? "public (MEP)" : "private"}${input.level ? ` · level: ${input.level}` : ""}${input.district ? ` · district: ${input.district}` : ""}`,
  );
  lines.push(
    `Zone: streets within ${SCHOOL_ZONE.GATE_RADIUS_M} m walking distance of the gate (the "gate ring") and within ${SCHOOL_ZONE.WALK_RADIUS_M} m (the "walk ring"). Gate-ring streets count double.`,
  );
  lines.push(
    `Coverage: ${Math.round(100 * s.coverage)}% of the zone's street length has been assessed. ${s.counts.assessed} of ${s.counts.members} segments. ${input.gap_count} segments (${Math.round(input.gap_length_m)} m) have never been recorded.`,
  );
  lines.push(`Rating: ${TIER_PROSE[s.tier] ?? s.tier}.`);

  if (s.score !== null) {
    lines.push(`School Score: ${s.score} out of 100.`);
  }
  if (s.compliance !== null) {
    lines.push(
      `Ley 7600 compliance: ${Math.round(100 * s.compliance)}% of the weighted walk meets the legal accessibility minimum of ${LEY_7600_MIN_SCORE}.`,
    );
  }

  const lensLines = Object.entries(s.lenses)
    .filter(([, v]) => typeof v === "number")
    .map(([lens, v]) => `${lens} ${v} (weight ${Math.round(100 * (LENS_WEIGHTS as Record<string, number>)[lens])}%)`);
  if (lensLines.length) lines.push(`Lens means: ${lensLines.join(", ")}.`);

  if (s.gate_veto) {
    lines.push(
      `GATE VETO: ${s.gate_veto_segments.length} segment(s) inside the gate ring score below the safety floor, which caps this school at "critical" regardless of its average. These are the streets immediately outside the gate.`,
    );
  }

  const worst = s.defects.slice(0, 8);
  if (worst.length) {
    lines.push("Worst defects, by how much fixing each would recover:");
    for (const d of worst) {
      lines.push(
        `  - ${d.name} (${d.segment_id}), ${d.ring} ring: ${d.lens} scores ${d.score}; lifting it to the legal floor recovers ${d.points_recoverable} points.`,
      );
    }
  }

  if (s.seal.blockers.length) {
    lines.push(`Seal blocked by: ${s.seal.blockers.join(", ")}.`);
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You write the plain-language reading of a school's walking environment for StreetLens, a pedestrian-infrastructure instrument in Costa Rica.

You are given the arithmetic. You do not produce numbers of your own, you do not re-score anything, and you never contradict a figure you were given. Your job is to say what the figures mean for a child walking to this school.

Rules:
- Write for a parent, a school director, or a company's sustainability lead. Not for an engineer.
- Lead with the thing that actually matters at this school. If there is a gate veto, that is the lead, every time: a lethal block outside the door is not a footnote to a good average.
- Be concrete about WHERE. Name streets when the evidence names them.
- If coverage is low, say plainly that the rating is provisional and what is missing. Never imply more certainty than the coverage supports.
- No score is ever "good" in isolation. Say what it means to walk there.
- Do not recommend specific engineering works you have no evidence for. "The crossing outside the gate is missing" is a finding; "install a raised table" is not yours to say.
- Never use the word "utilize". Avoid em dashes.

Return:
- overall: one paragraph, 45-80 words, English.
- overall_es: the same paragraph in Costa Rican Spanish. A translation of the meaning, not word-for-word.
- findings: 2 to 5 short specific findings. Each may name the segment id it comes from.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  name: "school_assessment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["overall", "overall_es", "findings"],
    properties: {
      overall: { type: "string" },
      overall_es: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "segment_id"],
          properties: {
            text: { type: "string" },
            segment_id: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

export class AssessmentUnavailable extends Error {}

/**
 * Draft an assessment. Throws {@link AssessmentUnavailable} when the model is
 * not configured, so the admin surface can offer the hand-written path instead
 * of failing — an unconfigured key is a deployment state, not an error.
 */
export async function draftSchoolAssessment(
  input: AssessmentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DraftedAssessment> {
  const key = openaiApiKey();
  if (!key) throw new AssessmentUnavailable("no_api_key");

  const model = synthesisModel();
  const res = await fetchImpl(RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildAssessmentEvidence(input) },
      ],
      text: { format: RESPONSE_FORMAT },
      max_output_tokens: 900,
    }),
  });

  if (!res.ok) {
    throw new AssessmentUnavailable(`model_http_${res.status}`);
  }

  const json = (await res.json()) as {
    output?: { content?: { type?: string; text?: string }[] }[];
    output_text?: string;
  };

  // The Responses API returns the text either flattened or nested depending on
  // the model; take whichever is present rather than assuming a shape.
  const text =
    json.output_text ??
    json.output
      ?.flatMap((o) => o.content ?? [])
      .find((c) => typeof c.text === "string")?.text;

  if (!text) throw new AssessmentUnavailable("empty_response");

  let parsed: Omit<DraftedAssessment, "model">;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AssessmentUnavailable("unparsable_response");
  }

  if (typeof parsed.overall !== "string" || !parsed.overall.trim()) {
    throw new AssessmentUnavailable("empty_overall");
  }

  return {
    overall: parsed.overall.trim(),
    overall_es: typeof parsed.overall_es === "string" ? parsed.overall_es.trim() : "",
    findings: Array.isArray(parsed.findings)
      ? parsed.findings
          .filter((f) => f && typeof f.text === "string" && f.text.trim())
          .map((f) => ({ text: f.text.trim(), segment_id: f.segment_id ?? null }))
      : [],
    model,
  };
}
