/**
 * Extraction knobs and the cost ceilings, in one place.
 *
 * These are the numbers that stand between a pilot and a surprise invoice, so
 * they live together where they can be read as a set rather than being scattered
 * across the worker.
 */

import { staticRequestApproxTokens } from "./prompt";

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

/** The workhorse. One call per frame, all 15 items. */
export function visionModel(): string {
  return process.env.OPENAI_VISION_MODEL || "gpt-5-nano";
}

/** Asked again only when the workhorse abstains. See ESCALATION_* below. */
export function escalationModel(): string {
  return process.env.OPENAI_VISION_ESCALATION_MODEL || "gpt-5.4-mini";
}

/**
 * The model that writes the per-segment synthesis: one text-only call that reads
 * the whole traversal and reasons across frames. Defaults to the escalation
 * model — synthesis is a language task, not a vision one, and there is one small
 * call per segment, so the stronger model is affordable here where it is not per
 * frame. `OPENAI_SYNTHESIS_MODEL` overrides it independently of the vision path.
 */
export function synthesisModel(): string {
  return process.env.OPENAI_SYNTHESIS_MODEL || escalationModel();
}

export function openaiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

/**
 * The global kill switch. Anything other than the exact string "true" disables
 * extraction.
 *
 * Fail-closed on purpose: a typo, an empty string or an unset variable must
 * never be the thing that authorizes spending money. Note that finalize still
 * matches and enqueues when this is off — the frames and the queue are free, and
 * flipping the switch back on drains the backlog without asking contributors to
 * walk the street again.
 */
export function extractionEnabled(): boolean {
  return process.env.CV_EXTRACTION_ENABLED === "true";
}

/* ------------------------------------------------------------------ *
 * The cost breaker
 * ------------------------------------------------------------------ */

/**
 * What one frame's image is allowed to cost, on top of the prompt.
 *
 * lib/extraction/downscale.ts sends at most a 512 px JPEG: ~192 patches ~= 470
 * tokens at gpt-5-nano's 2.46x multiplier, measured. 1200 is ~2.5x that, which
 * absorbs a different model's multiplier and the ~10% the static estimate
 * overshoots by, while still catching a provider that bills an order of
 * magnitude more than the pixels it was handed.
 *
 * Note what this budget no longer has to survive: a 4K frame billed at full
 * resolution. Nobody can bill us for pixels we did not send.
 */
export const IMAGE_TOKEN_BUDGET = 1200;

/**
 * Hard per-frame input-token ceiling. Exceeding it fails the job and pauses the
 * whole session.
 *
 * THIS IS THE POINT OF THE GUARD, not a formality. A provider that bills full
 * resolution instead of what it was sent turns a 400-frame session into orders
 * of magnitude more spend, silently and successfully — every response still
 * looks fine. The only way to notice is to assert the number we were billed.
 *
 * DERIVED, NOT FLAT. It used to be a hardcoded 2600, which quietly became a
 * tripwire on our own request: the cached prefix alone is deliberately ~2700
 * tokens (it has to clear 1024 for prompt caching to engage at all) and the
 * strict schema is ~1900 more, so the ceiling fired on every correct call. A
 * ceiling that has to be re-tuned by hand whenever the rubric text changes is a
 * ceiling that will be raised until it means nothing. Measuring the request
 * instead means editing prompt.ts or schema.ts cannot silently break the
 * breaker, in either direction.
 *
 * `CV_INPUT_TOKEN_CEILING` overrides it outright, for a model whose image
 * multiplier makes the derived number wrong.
 */
export function inputTokenCeiling(): number {
  const override = Number(process.env.CV_INPUT_TOKEN_CEILING);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return staticRequestApproxTokens() + IMAGE_TOKEN_BUDGET;
}

/** The ceiling's composition, for the message a tripped breaker leaves behind. */
export function describeInputTokenCeiling(): string {
  const override = Number(process.env.CV_INPUT_TOKEN_CEILING);
  if (Number.isFinite(override) && override > 0) {
    return `${Math.floor(override)} (CV_INPUT_TOKEN_CEILING override)`;
  }
  return `${inputTokenCeiling()} = ~${staticRequestApproxTokens()} static request (prompt + schema) + ${IMAGE_TOKEN_BUDGET} image budget`;
}

/**
 * Per-session input-token allowance, per frame. The session budget is frames x
 * this, and a session that blows through it is paused rather than allowed to
 * keep spending.
 *
 * Derived from the per-frame ceiling plus the escalation cap, because those two
 * together are what a healthy session can legitimately reach: no frame may bill
 * above the ceiling, and at most ESCALATION_MAX_FRACTION of them are asked
 * twice. A session past this has drifted in a way no single frame's ceiling
 * could see, which is the whole reason the session guard exists alongside it.
 *
 * `CV_SESSION_TOKENS_PER_FRAME` overrides it.
 */
export function sessionInputTokensPerFrame(): number {
  const override = Number(process.env.CV_SESSION_TOKENS_PER_FRAME);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return Math.ceil(inputTokenCeiling() * (1 + ESCALATION_MAX_FRACTION));
}

export function sessionTokenBudget(frameCount: number): number {
  return Math.max(1, frameCount) * sessionInputTokensPerFrame();
}

/* ------------------------------------------------------------------ *
 * Escalation
 * ------------------------------------------------------------------ */

/**
 * An item scored below this confidence means the cheap model is guessing. One
 * such item on a usable frame is enough to ask the stronger model instead —
 * a hedged answer that reaches a rollup is worse than no answer, because it
 * looks like data.
 */
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.35;

/**
 * At most this fraction of a session's frames may escalate. Without a cap, a
 * session shot in poor light escalates every frame and quietly becomes a
 * session priced at the expensive model.
 */
export const ESCALATION_MAX_FRACTION = 0.1;

/* ------------------------------------------------------------------ *
 * Synthesis
 * ------------------------------------------------------------------ */

/**
 * The most the synthesis pass may move any single lens score, in points, up or
 * down from the deterministic baseline.
 *
 * The baseline rollup (lib/capture/rollup.ts) is the measurement; synthesis is a
 * bounded, reasoned correction on top of it, never a replacement. A hard clamp
 * is what keeps a language model from quietly rewriting the numbers: it may
 * argue a segment's accessibility down twenty points because a sidewalk vanishes
 * halfway along, but it cannot turn a 30 into an 80. Every non-zero adjustment
 * it applies must also carry a written reason (enforced in synthesis.ts), so a
 * reviewer can see both the size and the cause of every move.
 *
 * `CV_SYNTHESIS_MAX_ADJUST` overrides it.
 */
export function synthesisMaxAdjust(): number {
  const override = Number(process.env.CV_SYNTHESIS_MAX_ADJUST);
  if (Number.isFinite(override) && override >= 0) return override;
  return 20;
}

/* ------------------------------------------------------------------ *
 * Queue + retries
 * ------------------------------------------------------------------ */

/** Jobs claimed per pump call. */
export const PUMP_BATCH_SIZE = 40;

/** In-flight model calls per pump. Bounds burst spend and provider rate limits. */
export const PUMP_CONCURRENCY = 8;

/**
 * A job that has been attempted this many times is failed for good.
 * capture_claim_jobs_with_frames increments `attempts` on claim, so this counts
 * claims, and a job whose worker dies mid-call still converges on failure rather
 * than being retried forever.
 */
export const MAX_JOB_ATTEMPTS = 3;

/** Transport-level retries within a single attempt (429/5xx only). */
export const HTTP_MAX_RETRIES = 3;

/** Sessions rolled up per pump call. */
export const ROLLUP_BATCH_SIZE = 5;
