/**
 * Extraction knobs and the cost ceilings, in one place.
 *
 * These are the numbers that stand between a pilot and a surprise invoice, so
 * they live together where they can be read as a set rather than being scattered
 * across the worker.
 */

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
 * Hard per-frame input-token ceiling. Exceeding it fails the job and pauses the
 * whole session.
 *
 * THIS IS THE POINT OF THE GUARD, not a formality. `detail: "low"` is supposed
 * to cap an image at ~85 tokens, but a provider that ignores the hint and bills
 * full resolution instead turns a 400-frame session into orders of magnitude
 * more spend, silently and successfully — every response still looks fine. The
 * only way to notice is to assert the number we were actually billed.
 *
 * 2600 sits well above a correct low-detail call (~85 image + ~1.3k prompt) and
 * well below a full-resolution one, so it discriminates cleanly without tripping
 * on ordinary variation.
 */
export const MAX_INPUT_TOKENS_PER_FRAME = 2600;

/**
 * Per-session input-token budget: frames x this. A session that blows through
 * it is paused rather than allowed to keep spending, even if no single frame
 * ever trips the per-frame ceiling.
 */
export const SESSION_INPUT_TOKENS_PER_FRAME = 1500;

export function sessionTokenBudget(frameCount: number): number {
  return Math.max(1, frameCount) * SESSION_INPUT_TOKENS_PER_FRAME;
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
