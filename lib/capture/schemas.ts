/**
 * Zod schemas for the CV capture funnel.
 *
 * Same contract-in-one-place philosophy as `lib/schemas.ts`: the browser
 * validates with these before uploading, and the route handlers validate with
 * the SAME schemas before touching the database. Nothing downstream re-derives
 * a shape by hand.
 *
 * Zod v4 throughout — errors are formatted with `z.treeifyError`, never the
 * removed `.format()`.
 */

import { z } from "zod";
import {
  CAPTURE_LIMITS,
  CAPTURE_SCHEMA_VERSION,
  CAPTURE_SESSION_STATUSES,
  RUBRIC_ITEM_KEYS,
  RUBRIC_ITEM_RESPONSE_TYPES,
  captureFrameStoragePath,
  type RubricItemKey,
  type RubricResponseType,
} from "./types";

/* ------------------------------------------------------------------ *
 * Primitives
 *
 * Coordinate bounds match lib/schemas.ts (generous Costa Rica bbox): they
 * reject obviously bogus fixes (0,0 / a GPS glitch into the Pacific) without
 * pretending to be a geofence.
 * ------------------------------------------------------------------ */

const LNG = z.number().min(-86).max(-82);
const LAT = z.number().min(8).max(11.5);

/**
 * Epoch milliseconds, UTC. Floor of 2020-01-01 rejects a device reporting
 * seconds-since-epoch or an uninitialized clock — a classic mobile bug that
 * would otherwise place every frame in 1970 and silently match nothing.
 */
const EPOCH_MS = z
  .number()
  .int()
  .min(1_577_836_800_000, "timestamp looks like seconds, not milliseconds")
  .max(4_102_444_800_000, "timestamp is implausibly far in the future");

export const trackPointSchema = z.object({
  lat: LAT,
  lng: LNG,
  t: EPOCH_MS,
  accuracy: z.number().min(0).max(10_000).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(200).optional(),
});
export type TrackPointInput = z.input<typeof trackPointSchema>;

/** A finalized track. Two fixes is the minimum that describes movement. */
export const trackSchema = z
  .array(trackPointSchema)
  .min(2, "A track needs at least two fixes")
  .max(100_000, "Track is too long");

export const trackSourceSchema = z.enum(["live", "gpx", "trace"]);
export const captureSessionModeSchema = z.enum(["live", "video"]);
export const captureSessionStatusSchema = z.enum(
  CAPTURE_SESSION_STATUSES as readonly [string, ...string[]],
);

/* ------------------------------------------------------------------ *
 * Frames
 * ------------------------------------------------------------------ */

export const captureFrameMetaSchema = z.object({
  seq: z.int().min(0).max(CAPTURE_LIMITS.maxFrames - 1),
  t: EPOCH_MS,
  storagePath: z.string().min(1).max(200),
  width: z.int().min(1).max(20_000),
  height: z.int().min(1).max(20_000),
  bytes: z.int().min(1).max(CAPTURE_LIMITS.maxFrameBytes),
  blurScore: z.number().min(0).optional(),
});
export type CaptureFrameMetaInput = z.input<typeof captureFrameMetaSchema>;

/**
 * Frames as registered for a specific session.
 *
 * Takes the session id because `storagePath` is not free-form: it must be
 * exactly the path the convention derives, and seqs must be unique within the
 * batch. Validating that here means the route never trusts a client-chosen
 * path, and the storage RLS policy re-checks the same rule in the database.
 */
export function registerFramesRequestSchemaFor(sessionId: string) {
  return z.object({
    frames: z
      .array(captureFrameMetaSchema)
      .min(1, "No frames to register")
      .max(CAPTURE_LIMITS.maxFrames)
      .superRefine((frames, ctx) => {
        const seen = new Set<number>();
        frames.forEach((frame, i) => {
          if (seen.has(frame.seq)) {
            ctx.addIssue({
              code: "custom",
              path: [i, "seq"],
              message: `duplicate seq ${frame.seq} in batch`,
            });
          }
          seen.add(frame.seq);

          const expected = captureFrameStoragePath(sessionId, frame.seq);
          if (frame.storagePath !== expected) {
            ctx.addIssue({
              code: "custom",
              path: [i, "storagePath"],
              message: `storagePath must be ${expected}`,
            });
          }
        });
      }),
  });
}

/* ------------------------------------------------------------------ *
 * Observations
 * ------------------------------------------------------------------ */

/**
 * Per-item value schema, keyed off the rubric's own response type.
 *
 * `null` is always allowed and always means "not assessable from this frame".
 * Booleans are accepted and normalized to 0|1 so a model that answers JSON
 * `true` is not a parse failure — the canonical stored value is numeric.
 */
function itemValueSchema(responseType: RubricResponseType) {
  switch (responseType) {
    case "boolean":
      return z
        .union([z.literal(0), z.literal(1), z.boolean()])
        .nullable()
        .transform((v): number | null => (typeof v === "boolean" ? (v ? 1 : 0) : v));
    case "scale_0_4":
      return z
        .int()
        .min(0)
        .max(4)
        .nullable()
        .transform((v): number | null => v);
    case "percent":
      return z
        .number()
        .min(0)
        .max(100)
        .nullable()
        .transform((v): number | null => v);
  }
}

function observationItemSchema(responseType: RubricResponseType) {
  return z.object({
    value: itemValueSchema(responseType),
    confidence: z.number().min(0).max(1),
  });
}

/**
 * Exactly the 15 rubric items — no more (strictObject), no fewer (every key is
 * required). A model that invents `sidewalk_colour` or silently drops
 * `curb_ramp` fails here rather than producing a half-scored segment.
 */
export const captureObservationItemsSchema = z.strictObject(
  Object.fromEntries(
    RUBRIC_ITEM_KEYS.map((key) => [
      key,
      observationItemSchema(RUBRIC_ITEM_RESPONSE_TYPES[key]),
    ]),
  ) as Record<RubricItemKey, ReturnType<typeof observationItemSchema>>,
);

export const captureFrameQualitySchema = z.object({
  usable: z.boolean(),
  reason: z.string().trim().min(1).max(200).optional(),
});

/**
 * A full per-frame extraction result. This is what the model is asked to
 * produce and what gets stored in `capture_observations.items`.
 */
export const captureObservationSchema = z.object({
  schemaVersion: z.literal(CAPTURE_SCHEMA_VERSION),
  model: z.string().trim().min(1).max(120),
  items: captureObservationItemsSchema,
  frameQuality: captureFrameQualitySchema,
  /**
   * The per-frame free-text rationale (target under 60 words; the prompt and the
   * JSON-schema description carry that instruction). The hard cap here is
   * deliberately loose — 1000 chars, well above three honest sentences — for the
   * same reason the token ceiling is loose: a cap tight enough to reject a
   * slightly-long answer would throw away a frame we already paid to score. Empty
   * is tolerated (`.min` is absent) so a terse-but-present note never fails a
   * paid frame; the strict wire schema still guarantees the field is present.
   */
  rationale: z.string().trim().max(1000),
});
export type CaptureObservationInput = z.input<typeof captureObservationSchema>;
export type CaptureObservationParsed = z.output<typeof captureObservationSchema>;

/* ------------------------------------------------------------------ *
 * API contracts (see app/api/capture/*)
 * ------------------------------------------------------------------ */

/**
 * POST /api/capture/sessions.
 *
 * `honeypot` must stay empty — same anti-bot convention as `submissionSchema`
 * in lib/schemas.ts. `contact` is optional and never published.
 */
export const createSessionRequestSchema = z.object({
  mode: captureSessionModeSchema,
  honeypot: z.string().max(0).optional().default(""),
  contact: z.string().trim().max(200).optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const createSessionResponseSchema = z.object({
  sessionId: z.uuid(),
  /** `captures/<sessionId>` — the client prefixes every frame path with this. */
  uploadPrefix: z.string().min(1),
  maxFrames: z.int().positive(),
  maxFrameBytes: z.int().positive(),
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const registerFramesResponseSchema = z.object({
  /** Seqs now registered — the client's resume cursor. */
  accepted: z.array(z.int().min(0)),
});
export type RegisterFramesResponse = z.infer<typeof registerFramesResponseSchema>;

/** POST /api/capture/sessions/[id]/finalize. */
export const finalizeRequestSchema = z.object({
  track: trackSchema,
  source: trackSourceSchema,
  /**
   * Device clock correction in ms (trueTime = deviceTime + clockOffsetMs).
   * Recorded, never applied to the raw fixes. Capped at ±1h: a larger skew
   * means the track and the frames cannot be trusted to align at all.
   */
  clockOffsetMs: z.int().min(-3_600_000).max(3_600_000).optional().default(0),
});
export type FinalizeRequest = z.infer<typeof finalizeRequestSchema>;

export const finalizeResponseSchema = z.object({
  status: captureSessionStatusSchema,
});

/** GET /api/capture/sessions/[id]. */
export const sessionStatusResponseSchema = z.object({
  status: captureSessionStatusSchema,
  frameCount: z.int().min(0),
  jobs: z.object({
    pending: z.int().min(0),
    done: z.int().min(0),
    failed: z.int().min(0),
  }),
  /** Present only once rollups exist (status review_ready and later). */
  rollups: z
    .array(
      z.object({
        segmentId: z.string(),
        coverage: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
        scores: z.record(z.string(), z.number().min(0).max(100)),
      }),
    )
    .optional(),
});
export type SessionStatusResponse = z.infer<typeof sessionStatusResponseSchema>;

/** POST /api/capture/pump. */
export const pumpResponseSchema = z.object({
  claimed: z.int().min(0),
  done: z.int().min(0),
  failed: z.int().min(0),
  remaining: z.int().min(0),
});
export type PumpResponse = z.infer<typeof pumpResponseSchema>;

/* ------------------------------------------------------------------ *
 * Segment synthesis (the FROZEN assessment contract)
 *
 * After the deterministic rollup, one text-only model call per segment reads the
 * whole traversal in order and produces a nuanced assessment: a prose verdict,
 * a per-lens explanation, and BOUNDED, REASONED score adjustments on top of the
 * baseline. This file is the contract in one place — the synthesis engine
 * (lib/extraction/synthesis.ts) fills it, the persist path stores it as jsonb,
 * and the review UI reads it back verbatim. Nothing downstream re-derives its
 * shape by hand.
 *
 * The four ADJUSTABLE lenses are accessibility, drainage, shade and bike — the
 * lenses a rollup measures directly. `overall` is never adjusted or invented by
 * the model: it is recomputed from the adjusted lens values with the SAME
 * renormalized 0.45/0.30/0.25 formula scoring.ts uses (see renormalizedOverall).
 * ------------------------------------------------------------------ */

/** The lenses synthesis may adjust. `overall` is derived, never adjusted. */
export const SYNTHESIS_LENS_KEYS = ["accessibility", "drainage", "shade", "bike"] as const;
export type SynthesisLensKey = (typeof SYNTHESIS_LENS_KEYS)[number];

/**
 * One lens adjustment. `delta` is points added to the baseline (negative lowers
 * it); the engine clamps it to ±CV_SYNTHESIS_MAX_ADJUST. `reason` is the written
 * justification the contract requires for every non-zero move — an adjustment
 * with no reason is dropped to zero rather than applied, so no unexplained number
 * ever reaches a reviewer.
 */
export const lensAdjustmentSchema = z.object({
  delta: z.number(),
  reason: z.string(),
});
export type LensAdjustment = z.infer<typeof lensAdjustmentSchema>;

const perLensProse = z.object({
  accessibility: z.string(),
  drainage: z.string(),
  shade: z.string(),
  bike: z.string(),
});

/**
 * What the MODEL returns, before the engine applies the bounds and recomputes
 * `overall`. Strict-schema-shaped: every adjustable lens carries an adjustment
 * object (delta 0, empty reason when unchanged), because a strict json_schema
 * cannot express optional keys. The engine turns this into the stored assessment.
 */
export const segmentAssessmentDraftSchema = z.object({
  overall: z.string(),
  lenses: perLensProse,
  adjustments: z.object({
    accessibility: lensAdjustmentSchema,
    drainage: lensAdjustmentSchema,
    shade: lensAdjustmentSchema,
    bike: lensAdjustmentSchema,
  }),
  /**
   * Spanish prose produced in the SAME synthesis call (0028). Optional at the
   * Zod layer so older fixtures / EN-only drafts still parse; the strict model
   * schema requires both locales.
   */
  overall_es: z.string().optional(),
  lenses_es: perLensProse.optional(),
});
export type SegmentAssessmentDraft = z.infer<typeof segmentAssessmentDraftSchema>;

const nullableScore = z.number().nullable();

/**
 * The stored assessment — the frozen shape the review UI consumes.
 *
 * `adjustments` here carries ONLY the lenses actually moved (a partial map), so a
 * reviewer sees the moves that happened and nothing else. `adjustedScores` is the
 * engine's output, never the model's: each lens is clamp(baseline + bounded delta,
 * 0, 100), a lens with a null baseline stays null (synthesis cannot invent a score
 * for a lens no frame could assess), and `overall` is recomputed from the adjusted
 * lenses.
 */
export const segmentAssessmentSchema = z.object({
  overall: z.string(),
  lenses: perLensProse,
  adjustments: z.object({
    accessibility: lensAdjustmentSchema.optional(),
    drainage: lensAdjustmentSchema.optional(),
    shade: lensAdjustmentSchema.optional(),
    bike: lensAdjustmentSchema.optional(),
  }),
  adjustedScores: z.object({
    overall: nullableScore,
    accessibility: nullableScore,
    drainage: nullableScore,
    shade: nullableScore,
    bike: nullableScore,
  }),
  model: z.string(),
});
export type SegmentAssessment = z.infer<typeof segmentAssessmentSchema>;

/**
 * Spanish prose companion stored in `assessment_es` (0028). Numbers stay on the
 * English assessment; only overall + per-lens explanations are localized.
 */
export const segmentAssessmentEsSchema = z.object({
  overall: z.string(),
  lenses: perLensProse,
});
export type SegmentAssessmentEs = z.infer<typeof segmentAssessmentEsSchema>;

/* ------------------------------------------------------------------ *
 * Parse helpers
 * ------------------------------------------------------------------ */

/** Parse+validate an unknown value as a capture observation. Throws on invalid input. */
export function parseCaptureObservation(input: unknown): CaptureObservationParsed {
  return captureObservationSchema.parse(input);
}

/** Parse+validate a stored segment assessment. Throws on invalid input. */
export function parseSegmentAssessment(input: unknown): SegmentAssessment {
  return segmentAssessmentSchema.parse(input);
}

/** Parse+validate Spanish assessment prose. Throws on invalid input. */
export function parseSegmentAssessmentEs(input: unknown): SegmentAssessmentEs {
  return segmentAssessmentEsSchema.parse(input);
}

/**
 * Prefer Spanish prose when the viewer locale is `es` and assessment_es exists;
 * otherwise fall back to the English assessment overall. Never throws.
 */
export function assessmentOverallForLocale(
  assessment: unknown,
  assessmentEs: unknown,
  locale: string,
): string | null {
  const readOverall = (raw: unknown): string | null => {
    let a: unknown = raw;
    if (typeof a === "string") {
      const s = a.trim();
      if (!s || s === "null") return null;
      try {
        a = JSON.parse(s);
      } catch {
        return null;
      }
    }
    if (!a || typeof a !== "object" || Array.isArray(a)) return null;
    const overall = (a as { overall?: unknown }).overall;
    return typeof overall === "string" && overall.trim() ? overall.trim() : null;
  };

  if (locale === "es") {
    const es = readOverall(assessmentEs);
    if (es) return es;
  }
  return readOverall(assessment);
}
