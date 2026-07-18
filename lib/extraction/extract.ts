/**
 * One frame in, one validated observation out — with the cost breaker on the
 * way through.
 *
 * This module is deliberately ignorant of the queue, the session and the
 * database: it takes an image URL and a model, and reports what happened. The
 * policy that uses those reports (pause the session, escalate, retry, give up)
 * lives in the pump, where it can see the session as a whole.
 */

import {
  captureObservationSchema,
  type CaptureObservationParsed,
} from "@/lib/capture/schemas";
import { CAPTURE_SCHEMA_VERSION } from "@/lib/capture/types";
import type { VisionClient, VisionUsage } from "./client";
import { VisionTransportError } from "./client";
import {
  ESCALATION_CONFIDENCE_THRESHOLD,
  describeInputTokenCeiling,
  inputTokenCeiling,
} from "./config";
import { downscaleFrame } from "./downscale";

export type ExtractOutcome =
  | {
      kind: "ok";
      observation: CaptureObservationParsed;
      usage: VisionUsage;
      model: string;
    }
  /**
   * The response was billed above the per-frame ceiling. Distinct from `failed`
   * because the response may have been perfectly good — the problem is the
   * price, and the right reaction is to stop the session rather than retry it.
   */
  | {
      kind: "overbudget";
      usage: VisionUsage;
      model: string;
      inputTokens: number;
      /** The ceiling and what it is made of, for the pause message. */
      ceiling: string;
    }
  | { kind: "failed"; reason: string; usage: VisionUsage; model: string };

const NO_USAGE: VisionUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

/**
 * Turn a frame URL into the image the model is actually sent.
 *
 * Injectable so the tests drive the real resize against fixture bytes with no
 * network, and so the pump can fetch and shrink a frame once even when it asks
 * two models about it.
 */
export type ImagePreparer = (imageUrl: string) => Promise<string>;

export type ExtractOptions = { prepareImage?: ImagePreparer };

/**
 * Reconcile the wire's `reason` with the canonical one.
 *
 * These two disagree, and both are right. `strict` json_schema requires every
 * property to be present, so "no reason" has to travel as an explicit
 * `reason: null` — there is no way to ask for an omitted key. But
 * captureFrameQualitySchema (frozen, lib/capture/schemas.ts) types reason as an
 * OPTIONAL string, and zod's `.optional()` admits `undefined`, not `null`.
 *
 * So a perfectly good answer for a perfectly good frame — the common case —
 * would fail validation on the one field that says nothing was wrong. Dropping
 * the null here is the translation between the two, and it belongs at the
 * boundary rather than in either contract.
 */
function normalizeFrameQuality(raw: unknown): unknown {
  const quality = (raw as { frameQuality?: unknown })?.frameQuality;
  if (!quality || typeof quality !== "object") return quality;

  const { reason, ...rest } = quality as { reason?: unknown };
  return reason === null || reason === undefined ? rest : { ...rest, reason };
}

/**
 * Ask one model about one frame.
 *
 * The image is downscaled here rather than at the call site, so there is no path
 * to a model that skips it: what leaves this function is always a bounded
 * FRAME_MAX_EDGE_PX JPEG, whatever the caller passed in. See
 * lib/extraction/downscale.ts for why that is not something we ask the provider
 * to do for us any more.
 *
 * Order matters: the token assertion runs BEFORE the response is parsed. An
 * over-budget response that happens to contain valid JSON is still over budget,
 * and accepting it would mean the breaker only fires on frames we were going to
 * discard anyway.
 */
export async function extractFrame(
  client: VisionClient,
  imageUrl: string,
  model: string,
  options: ExtractOptions = {},
): Promise<ExtractOutcome> {
  let prepared: string;
  try {
    prepared = await (options.prepareImage ?? downscaleFrame)(imageUrl);
  } catch (err) {
    // The frame could not be fetched or decoded. Nothing was billed, and asking
    // the model about a full-resolution image instead is exactly the trade this
    // downscale exists to refuse.
    return {
      kind: "failed",
      reason: `image_prepare: ${err instanceof Error ? err.message : String(err)}`,
      usage: NO_USAGE,
      model,
    };
  }

  let response;
  try {
    response = await client.extract({ model, imageUrl: prepared });
  } catch (err) {
    // A transport failure that survived the retry policy. No usage to report:
    // nothing was billed for a request that never landed.
    const reason =
      err instanceof VisionTransportError
        ? `transport: ${err.message}`
        : `transport: ${err instanceof Error ? err.message : String(err)}`;
    return { kind: "failed", reason, usage: NO_USAGE, model };
  }

  // THE COST BREAKER. Checked on every response including refusals and
  // truncations, because those are billed too.
  if (response.usage.inputTokens > inputTokenCeiling()) {
    return {
      kind: "overbudget",
      usage: response.usage,
      model,
      inputTokens: response.usage.inputTokens,
      ceiling: describeInputTokenCeiling(),
    };
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

  // The model is not asked for `model` (it would confabulate one) and the schema
  // pins schemaVersion, but both are required by captureObservationSchema — so
  // they are stamped from what we know before validating.
  const candidate = {
    ...(raw as Record<string, unknown>),
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    model,
    frameQuality: normalizeFrameQuality(raw),
  };

  const parsed = captureObservationSchema.safeParse(candidate);
  if (!parsed.success) {
    // Strict json_schema should make this unreachable; it is handled anyway,
    // because "the provider guaranteed it" is not a thing worth betting a
    // corrupt rollup on.
    return {
      kind: "failed",
      reason: `schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      usage: response.usage,
      model,
    };
  }

  return { kind: "ok", observation: parsed.data, usage: response.usage, model };
}

/**
 * Did the cheap model abstain badly enough to be worth asking again?
 *
 * Only usable frames qualify. An unusable frame is a CORRECT low-confidence
 * answer — the truck really is in the way — and paying a stronger model to look
 * at the same truck buys nothing.
 *
 * Any single item below the threshold is enough. A frame where the model is
 * guessing at one item is a frame where that item reaches a rollup as noise, and
 * the rollup cannot tell noise from a reading.
 */
export function shouldEscalate(observation: CaptureObservationParsed): boolean {
  if (!observation.frameQuality.usable) return false;

  return Object.values(observation.items).some(
    (item) =>
      // A null value with low confidence is an honest "cannot see it", not a
      // guess — do not pay to re-ask.
      item.value !== null && item.confidence < ESCALATION_CONFIDENCE_THRESHOLD,
  );
}

/**
 * Frame-level confidence: the mean over items that carry an actual value.
 *
 * Nulls are excluded rather than counted as zero, so a frame that honestly
 * reports three things it can see is not scored as less certain than a frame
 * that guessed at fifteen. Null when nothing was assessable.
 */
export function observationConfidence(observation: CaptureObservationParsed): number | null {
  const scored = Object.values(observation.items).filter((item) => item.value !== null);
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, item) => acc + item.confidence, 0);
  return Math.round((sum / scored.length) * 1000) / 1000;
}
