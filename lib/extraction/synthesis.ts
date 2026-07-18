/**
 * Segment synthesis: one text-only model call that reads a whole traversal and
 * writes a nuanced, cross-frame assessment.
 *
 * WHY THIS EXISTS. The deterministic rollup (lib/capture/rollup.ts) is an
 * average of medians: it cannot see that a crosswalk present at the top of a
 * street then vanishes for two hundred metres, that a sidewalk starts and stops,
 * or that the one drain is nowhere near the low point where the water actually
 * pools. Those are facts ACROSS frames, and an average erases them. Synthesis
 * reads the frames in traversal order, with the distance between them, and is
 * asked to reason about continuity and gaps — then to explain each lens and,
 * within a hard bound, to correct the score where the shape of the walk warrants
 * it.
 *
 * WHAT IT MAY AND MAY NOT DO. The rollup stays the baseline. Synthesis may move
 * each adjustable lens by at most ±CV_SYNTHESIS_MAX_ADJUST points, and every
 * non-zero move must carry a written reason or it is dropped. It may never invent
 * a score for a lens no frame could assess (a null baseline stays null), and it
 * never sets `overall` — that is recomputed from the adjusted lenses with
 * scoring.ts's own formula. The model writes prose and proposes bounded deltas;
 * the arithmetic is ours.
 *
 * PURE CORE, INJECTED EDGE. Everything except the network call is a pure function
 * of its inputs (evidence building, clamping, recompute), so the node tests drive
 * the real reasoning against a scripted client with no bill and no clock.
 */

import {
  RUBRIC_ITEM_KEYS,
  type RubricItemKey,
  type CaptureObservationItem,
} from "@/lib/capture/types";
import { renormalizedOverall, type LensScores, type LensKey } from "@/lib/capture/scoring";
import type { ItemMedian } from "@/lib/capture/rollup";
import {
  SYNTHESIS_LENS_KEYS,
  segmentAssessmentDraftSchema,
  segmentAssessmentEsSchema,
  type SynthesisLensKey,
  type LensAdjustment,
  type SegmentAssessment,
  type SegmentAssessmentDraft,
  type SegmentAssessmentEs,
} from "@/lib/capture/schemas";
import {
  HTTP_MAX_RETRIES,
  openaiApiKey,
  synthesisMaxAdjust,
  synthesisMaxOutputTokens,
  synthesisModel,
} from "./config";
import {
  backoffMs,
  isRetryable,
  parseVisionPayload,
  sleep,
  VisionTransportError,
  type VisionResponse,
  type VisionUsage,
} from "./client";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/**
 * One frame as synthesis needs it: its place in the walk, whether it sits at a
 * junction, the 15 item readings with confidence, and the per-frame rationale.
 * `location` is the interpolated capture position (capture_frames.location);
 * null when the frame could not be placed, in which case it contributes no
 * distance.
 */
export type SynthesisFrame = {
  seq: number;
  location: { lng: number; lat: number } | null;
  nearJunction: boolean;
  /** False for a frame the model could not read; still listed, plainly flagged. */
  usable: boolean;
  items: Record<RubricItemKey, CaptureObservationItem>;
  rationale: string | null;
};

/** Everything one synthesis call reads: the frames plus the baseline it may adjust. */
export type SynthesisSegmentInput = {
  segmentId: string;
  /** Any order; the engine sorts by seq into traversal order. */
  frames: SynthesisFrame[];
  baselineScores: LensScores;
  itemMedians: Record<string, ItemMedian>;
};

export type SynthesizeOptions = {
  model?: string;
  maxAdjust?: number;
};

export type SynthesisOutcome =
  | {
      kind: "ok";
      assessment: SegmentAssessment;
      /** Spanish prose companion; null when the model omitted usable ES copy. */
      assessmentEs: SegmentAssessmentEs | null;
      usage: VisionUsage;
      model: string;
    }
  | { kind: "failed"; reason: string; usage: VisionUsage; model: string };

const NO_USAGE: VisionUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * Great-circle distance in metres between two lng/lat points.
 *
 * The haversine, not a projected approximation: segments are short and near the
 * equator, but "distance-weighted severity" is a first-class input to the model,
 * so the metres it reasons over should be honest rather than a planar guess.
 */
export function haversineMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A frame placed on the walk: its cumulative distance and the gap since the last placed frame. */
type PlacedFrame = SynthesisFrame & {
  /** Metres from the first placed frame, along the walk. Null when unplaced. */
  cumulativeM: number | null;
  /** Metres since the previous placed frame. Null for the first / for unplaced. */
  gapM: number | null;
};

/** Sort by seq (traversal order) and annotate each frame with distance along the walk. */
function placeFrames(frames: readonly SynthesisFrame[]): PlacedFrame[] {
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);
  let cumulative = 0;
  let prevLoc: { lng: number; lat: number } | null = null;
  let seenPlaced = false;

  return ordered.map((frame) => {
    if (!frame.location) {
      return { ...frame, cumulativeM: null, gapM: null };
    }
    let gapM: number | null = null;
    if (prevLoc) {
      gapM = haversineMeters(prevLoc, frame.location);
      cumulative += gapM;
    } else if (!seenPlaced) {
      // First placed frame is the origin of the walk.
      cumulative = 0;
    }
    prevLoc = frame.location;
    seenPlaced = true;
    return { ...frame, cumulativeM: cumulative, gapM };
  });
}

/** Total traversal distance in metres, from the placed frames. */
function traversalMeters(placed: readonly PlacedFrame[]): number {
  let total = 0;
  for (const f of placed) if (f.gapM) total += f.gapM;
  return total;
}

/* ------------------------------------------------------------------ *
 * Evidence
 *
 * Compact and deterministic: the model reads text, and every byte is billed, so
 * the encoding is terse and its order is fixed. Null item readings are omitted
 * rather than spelled out — a frame that does not report crossing_safety is a
 * frame with no crossing in shot, and that ABSENCE is exactly the cross-frame
 * signal the continuity block below turns into a gap.
 * ------------------------------------------------------------------ */

/**
 * Items whose presence or absence along the walk is a continuity signal: the
 * boolean infrastructure items plus the two junction-read items. A crosswalk
 * that appears once then never again, a sidewalk that starts and stops, a single
 * drain on a long block — these are what "it cannot just be an average" means.
 */
const CONTINUITY_ITEMS: readonly RubricItemKey[] = [
  "sidewalk_present",
  "curb_ramp",
  "crossing_safety",
  "drain_present",
  "bike_lane_present",
];

const round = (v: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** "sidewalk_present=1@0.95" — one item reading, compact. */
function itemToken(key: RubricItemKey, item: CaptureObservationItem): string | null {
  if (item.value === null || item.value === undefined || !Number.isFinite(item.value)) return null;
  return `${key}=${item.value}@${round(item.confidence, 2)}`;
}

/** One frame's line: seq, distance along the walk, gap, junction flag, readings, rationale. */
function frameLine(frame: PlacedFrame): string {
  const parts: string[] = [`#${frame.seq}`];
  parts.push(frame.cumulativeM === null ? "@?" : `@${round(frame.cumulativeM)}m`);
  if (frame.gapM !== null) parts.push(`(+${round(frame.gapM)}m)`);
  if (frame.nearJunction) parts.push("JUNCTION");
  if (!frame.usable) parts.push("UNUSABLE");

  const readings = RUBRIC_ITEM_KEYS.map((key) => itemToken(key, frame.items[key])).filter(
    (t): t is string => t !== null,
  );
  const head = parts.join(" ");
  const body = readings.length ? readings.join(" ") : "no assessable items";
  const rationale = frame.rationale?.trim() ? ` :: ${frame.rationale.trim()}` : "";
  return `${head} | ${body}${rationale}`;
}

type Presence = "present" | "absent" | "unknown";

/** Classify one item value for continuity: present (>0), absent (0), unknown (null). */
function classify(item: CaptureObservationItem | undefined): Presence {
  if (!item || item.value === null || item.value === undefined || !Number.isFinite(item.value)) {
    return "unknown";
  }
  return item.value > 0 ? "present" : "absent";
}

type Run = { presence: Presence; fromSeq: number; toSeq: number; fromM: number | null; toM: number | null };

/**
 * Continuity signals: for each continuity item, the runs of present / absent /
 * unknown along the walk, with distance spans. Only emitted for an item that
 * actually changes state at least once — a uniformly-present or uniformly-absent
 * item carries no gap to reason about, and spelling it out would be tokens for
 * nothing. This block is what encodes "a crosswalk, then none for a long stretch".
 */
export function continuitySignals(placed: readonly PlacedFrame[]): string[] {
  const lines: string[] = [];

  for (const key of CONTINUITY_ITEMS) {
    const runs: Run[] = [];
    for (const frame of placed) {
      const presence = classify(frame.items[key]);
      const last = runs[runs.length - 1];
      if (last && last.presence === presence) {
        last.toSeq = frame.seq;
        if (frame.cumulativeM !== null) last.toM = frame.cumulativeM;
      } else {
        runs.push({
          presence,
          fromSeq: frame.seq,
          toSeq: frame.seq,
          fromM: frame.cumulativeM,
          toM: frame.cumulativeM,
        });
      }
    }

    // A transition exists only if more than one run formed.
    if (runs.length <= 1) continue;

    const spans = runs
      .map((r) => {
        const span =
          r.fromM !== null && r.toM !== null ? `${round(r.fromM)}-${round(r.toM)}m` : "?m";
        const seqs = r.fromSeq === r.toSeq ? `#${r.fromSeq}` : `#${r.fromSeq}-#${r.toSeq}`;
        const meters =
          r.fromM !== null && r.toM !== null ? round(r.toM - r.fromM) : null;
        const length = meters !== null ? `, ${meters}m` : "";
        return `${r.presence} ${seqs} (${span}${length})`;
      })
      .join(" -> ");
    lines.push(`${key}: ${spans}`);
  }

  return lines;
}

/** "accessibility=72.5, drainage=null, ..." — the baseline the model may adjust. */
function baselineLine(scores: LensScores): string {
  const order: LensKey[] = ["overall", "accessibility", "drainage", "shade", "bike"];
  return order.map((k) => `${k}=${scores[k] === null ? "null" : scores[k]}`).join(", ");
}

/** "sidewalk_width=median 2 (conf 0.7, 4 frames)" — the item medians, deterministic order. */
function itemMediansLines(medians: Record<string, ItemMedian>): string[] {
  return RUBRIC_ITEM_KEYS.filter((k) => medians[k] && medians[k].value !== null).map((k) => {
    const m = medians[k];
    return `${k}=median ${m.value} (conf ${m.confidence ?? "?"}, ${m.frames} frames)`;
  });
}

/**
 * The full evidence turn for one segment. Deterministic given its input — no
 * clock, no randomness — so a fixture always builds the same bytes and a test can
 * assert on them.
 */
export function buildSynthesisEvidence(input: SynthesisSegmentInput): string {
  const placed = placeFrames(input.frames);
  const totalM = round(traversalMeters(placed));
  const continuity = continuitySignals(placed);
  const medians = itemMediansLines(input.itemMedians);

  const sections: string[] = [
    `SEGMENT ${input.segmentId}`,
    `${placed.length} frames in traversal order, ${totalM}m walked.`,
    ``,
    `BASELINE LENS SCORES (0-100, the deterministic rollup you may adjust): ${baselineLine(
      input.baselineScores,
    )}`,
    ``,
    `ITEM MEDIANS (rubric item -> confidence-weighted median across the segment):`,
    medians.length ? medians.map((l) => `  ${l}`).join("\n") : "  (none assessable)",
    ``,
    `FRAMES (each: #seq @distance-along-walk (+gap) flags | item=value@confidence :: rationale):`,
    ...placed.map((f) => `  ${frameLine(f)}`),
    ``,
    `CONTINUITY ALONG THE WALK (presence/absence of key features, with distance spans):`,
    continuity.length
      ? continuity.map((l) => `  ${l}`).join("\n")
      : "  (no notable continuity changes detected)",
  ];

  return sections.join("\n");
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

/**
 * The synthesis system prompt. Unlike the vision prompt this is not cache-tuned:
 * there is one call per segment and every evidence turn differs, so byte-identity
 * buys nothing. It embeds the current adjustment bound so the model is told the
 * exact ceiling it is being clamped to.
 */
export function synthesisSystemPrompt(maxAdjust: number): string {
  return [
    `You are a senior street-infrastructure reviewer for a Costa Rican municipality pilot. You are given ONE street segment as a traversal: a sequence of frames in the order they were walked, each with its distance along the walk, whether it sits at a junction, the 15 rubric item readings the vision pass produced (with the model's confidence), and a per-frame note. You are also given the deterministic BASELINE lens scores (an average of medians) and the item medians.`,
    ``,
    `YOUR JOB is to read the segment AS A WHOLE and write a nuanced assessment that an averaging rollup cannot. Reason ACROSS the frames, not frame by frame:`,
    `- CONTINUITY AND GAPS. A feature that is present in one place and absent for a long stretch is worse than its average suggests. A crosswalk at the top of the block then none for two hundred metres, a sidewalk that starts and stops, a single drain on a long hill: name these, and let them move the score. The continuity block spells out the runs and their distances for you.`,
    `- JUNCTION CONTEXT. curb_ramp and crossing_safety are read only at junction frames; judge them where they were seen, and note when a junction lacks the crossing provision it needs.`,
    `- DISTANCE-WEIGHTED SEVERITY. A defect that persists over a long distance matters more than one at a single frame. Use the metres, not the frame count.`,
    ``,
    `DO NOT RE-AVERAGE. The baseline already is the average. Your value is the reasoning the average cannot capture. Do not recompute the mean of the readings and report it back.`,
    ``,
    `BOUNDED ADJUSTMENTS. For each of the four adjustable lenses — accessibility, drainage, shade, bike — you may propose a delta in points to add to (negative: subtract from) the baseline, bounded to at most ${maxAdjust} points either way. Anything larger will be clamped. Every non-zero delta MUST carry a written reason grounded in the evidence; a delta with no reason is discarded. Leave a lens at delta 0 when the baseline is already right. You do NOT set the overall score: it is recomputed from your adjusted lenses. You cannot score a lens whose baseline is null (no frame could assess it) — leave its delta 0, but you may still explain in its lens text WHY it is unknown. Adjustment reasons stay in English (reviewer-facing).`,
    ``,
    `BILINGUAL PROSE (ONE CALL). Write the assessment twice: English in overall/lenses, and a faithful Spanish translation in overall_es/lenses_es. Same facts and tone; do not invent different claims per locale. Keep each field concise — a few sentences for overall, one short paragraph per lens — to stay within the output token budget.`,
    ``,
    `OUTPUT. Return JSON matching the provided schema exactly:`,
    `- overall / overall_es: a few sentences, the nuanced verdict for the whole segment, grounded in what changes along the walk.`,
    `- lenses / lenses_es: one honest explanation each for accessibility, drainage, shade, bike.`,
    `- adjustments: for each of the four lenses, { delta, reason }. delta 0 with an empty reason means no change.`,
    `No prose outside these fields.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The strict response schema
 * ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

function adjustmentSchema(lens: string, maxAdjust: number): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["delta", "reason"],
    properties: {
      delta: {
        type: "number",
        description: `Points to add to the baseline ${lens} score (negative lowers it). 0 means no change. Bounded to +/-${maxAdjust}; larger values are clamped.`,
      },
      reason: {
        type: "string",
        description:
          "Written justification grounded in the evidence, REQUIRED whenever delta is not 0. Empty string when delta is 0.",
      },
    },
  };
}

function lensProseSchema(lens: string): JsonSchema {
  return {
    type: "string",
    description: `Plain-language explanation of the ${lens} lens for this segment: what the frames show along the walk and why the score is what it is.`,
  };
}

/** The `text.format` block for the synthesis call — strict, so the shape is guaranteed. */
export function synthesisResponseFormat(maxAdjust: number) {
  const proseProps: Record<string, JsonSchema> = {};
  const proseEsProps: Record<string, JsonSchema> = {};
  const adjProps: Record<string, JsonSchema> = {};
  for (const lens of SYNTHESIS_LENS_KEYS) {
    proseProps[lens] = lensProseSchema(lens);
    proseEsProps[lens] = {
      type: "string",
      description: `Spanish translation of the ${lens} lens explanation. Same facts as English.`,
    };
    adjProps[lens] = adjustmentSchema(lens, maxAdjust);
  }

  return {
    type: "json_schema" as const,
    name: "segment_synthesis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "lenses", "adjustments", "overall_es", "lenses_es"],
      properties: {
        overall: {
          type: "string",
          description:
            "English: a few sentences — the nuanced overall verdict for this segment, grounded in the cross-frame evidence, not a re-average of the readings.",
        },
        lenses: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: proseProps,
        },
        adjustments: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: adjProps,
        },
        overall_es: {
          type: "string",
          description:
            "Spanish translation of overall. Same verdict and facts; natural Costa Rican Spanish.",
        },
        lenses_es: {
          type: "object",
          additionalProperties: false,
          required: [...SYNTHESIS_LENS_KEYS],
          properties: proseEsProps,
        },
      },
    },
  } satisfies JsonSchema;
}

/**
 * Extract Spanish prose from a draft. Returns null when ES fields are missing
 * or empty so callers fall back to English on public surfaces.
 */
export function extractAssessmentEs(draft: SegmentAssessmentDraft): SegmentAssessmentEs | null {
  const overall = (draft.overall_es ?? "").trim();
  if (!overall) return null;
  const lenses = draft.lenses_es;
  if (!lenses) return null;
  const parsed = segmentAssessmentEsSchema.safeParse({
    overall,
    lenses: {
      accessibility: (lenses.accessibility ?? "").trim(),
      drainage: (lenses.drainage ?? "").trim(),
      shade: (lenses.shade ?? "").trim(),
      bike: (lenses.bike ?? "").trim(),
    },
  });
  if (!parsed.success) return null;
  // Require non-empty overall; empty lens strings are allowed (unknown lens).
  return parsed.data;
}

/* ------------------------------------------------------------------ *
 * Applying the bounds and recomputing overall
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Turn the model's draft into the stored assessment: clamp every delta to the
 * bound, drop any non-zero delta with no reason, apply it to the baseline, and
 * recompute overall from the adjusted lenses.
 *
 * Pure and exported so a test can prove the four rules directly (clamp, null stays
 * null, unexplained dropped, overall recomputed not copied) without a model.
 */
export function applyAssessment(
  draft: SegmentAssessmentDraft,
  baselineScores: LensScores,
  model: string,
  maxAdjust: number,
): SegmentAssessment {
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

    // No unexplained adjustment ever applies.
    if (delta !== 0 && reason.length === 0) delta = 0;

    if (base === null) {
      // A lens no frame could assess stays unknown — synthesis cannot invent it,
      // and any proposed delta is meaningless against a null baseline.
      adjustedScores[lens] = null;
      continue;
    }

    const value = round2(clamp(base + delta, 0, 100));
    adjustedScores[lens] = value;
    if (delta !== 0) adjustments[lens] = { delta, reason };
  }

  // overall is NEVER the model's: recompute it from the adjusted lenses with the
  // same renormalized 0.45/0.30/0.25 formula the rollup uses.
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

/* ------------------------------------------------------------------ *
 * The model client
 *
 * A second, deliberately small consumer of the same Responses API the vision
 * client uses — text in, strict JSON out. It reuses that module's payload parser
 * and retry primitives rather than re-deriving them (there must be one definition
 * of "which HTTP failures are worth retrying" and one of "how to read a Responses
 * payload"), but keeps its own request body, which is text-only and carries no
 * cacheable prefix. `SynthesisClient` is an interface so the tests inject a
 * scripted client and drive the real engine with no network and no bill.
 * ------------------------------------------------------------------ */

export type SynthesisRequest = {
  model: string;
  system: string;
  user: string;
  format: unknown;
};

export interface SynthesisClient {
  synthesize(request: SynthesisRequest): Promise<VisionResponse>;
}

export type OpenAiSynthesisClientOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  rand?: () => number;
  sleepImpl?: (ms: number) => Promise<void>;
};

/** Build the text-only Responses request body. Exported for assertion in tests. */
export function buildSynthesisRequestBody(request: SynthesisRequest): Record<string, unknown> {
  return {
    model: request.model,
    instructions: request.system,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: request.user }],
      },
    ],
    text: { format: request.format },
    // Bound bilingual output so one call cannot runaway-bill on long prose.
    max_output_tokens: synthesisMaxOutputTokens(),
    // NO temperature — the gpt-5 reasoning models 400 the whole request on it.
    store: false,
  };
}

export function createOpenAiSynthesisClient(
  options: OpenAiSynthesisClientOptions = {},
): SynthesisClient {
  const doFetch = options.fetchImpl ?? fetch;
  const rand = options.rand ?? Math.random;
  const doSleep = options.sleepImpl ?? sleep;

  return {
    async synthesize(request) {
      const apiKey = options.apiKey ?? openaiApiKey();
      if (!apiKey) throw new VisionTransportError("OPENAI_API_KEY is not configured");

      let lastError = "";
      let lastStatus: number | undefined;

      for (let attempt = 0; attempt < HTTP_MAX_RETRIES; attempt++) {
        if (attempt > 0) await doSleep(backoffMs(attempt, rand));

        let response: Response;
        try {
          response = await doFetch(RESPONSES_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(buildSynthesisRequestBody(request)),
          });
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          continue;
        }

        if (response.ok) {
          const payload = await response.json();
          return parseVisionPayload(payload);
        }

        lastStatus = response.status;
        lastError = await response.text().catch(() => response.statusText);
        if (!isRetryable(response.status, lastError)) {
          throw new VisionTransportError(
            `openai ${response.status}: ${lastError.slice(0, 500)}`,
            response.status,
          );
        }
      }

      throw new VisionTransportError(
        `openai unavailable after ${HTTP_MAX_RETRIES} attempts: ${lastError.slice(0, 500)}`,
        lastStatus,
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * The one call
 * ------------------------------------------------------------------ */

/**
 * Synthesize one segment: build the evidence, ask the model once, validate its
 * draft, and apply the bounds. Returns an outcome rather than throwing so the
 * pump can log a failure and leave the assessment null without ever failing the
 * segment — a reviewer who sees "no assessment" is told the truth.
 */
export async function synthesizeSegment(
  client: SynthesisClient,
  input: SynthesisSegmentInput,
  options: SynthesizeOptions = {},
): Promise<SynthesisOutcome> {
  const model = options.model ?? synthesisModel();
  const maxAdjust = options.maxAdjust ?? synthesisMaxAdjust();

  const system = synthesisSystemPrompt(maxAdjust);
  const user = buildSynthesisEvidence(input);
  const format = synthesisResponseFormat(maxAdjust);

  let response: VisionResponse;
  try {
    response = await client.synthesize({ model, system, user, format });
  } catch (err) {
    const reason =
      err instanceof VisionTransportError
        ? `transport: ${err.message}`
        : `transport: ${err instanceof Error ? err.message : String(err)}`;
    return { kind: "failed", reason, usage: NO_USAGE, model };
  }

  if (response.outcome !== "completed" || !response.text) {
    return {
      kind: "failed",
      reason: `${response.outcome}: ${response.detail ?? "no detail"}`,
      usage: response.usage,
      model,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(response.text);
  } catch (err) {
    return {
      kind: "failed",
      reason: `json_parse: ${err instanceof Error ? err.message : String(err)}`,
      usage: response.usage,
      model,
    };
  }

  const parsed = segmentAssessmentDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "failed",
      reason: `schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      usage: response.usage,
      model,
    };
  }

  const assessment = applyAssessment(parsed.data, input.baselineScores, model, maxAdjust);
  const assessmentEs = extractAssessmentEs(parsed.data);
  return { kind: "ok", assessment, assessmentEs, usage: response.usage, model };
}

