/**
 * Minimal per-key token bucket for anonymous throttling.
 *
 * LIMITATION (documented, intentional for MVP): this bucket lives in module
 * memory. It is per-serverless-instance and resets on redeploy or cold start,
 * so it slows casual abuse but is not a hard guarantee across a fleet. The
 * seam is deliberate — swap this module for a Redis / Postgres counter later
 * without touching the route. Keyed by the hashed IP (never a raw IP).
 *
 * NAMESPACES (u25): different flows have wildly different costs, so they get
 * separate ceilings and separate buckets. Posting a text submission is cheap;
 * opening a capture session invites 400 image uploads and a model bill, so it
 * is metered far harder. A caller in one namespace can never spend another's
 * tokens.
 *
 * Because of the reset-on-cold-start caveat above, `capture` ALSO enforces its
 * ceiling in the database (`capture_create_session`, 0013). This module is the
 * cheap fast path; the database is the one that actually holds.
 */

type Bucket = { tokens: number; updatedAt: number };

const BUCKETS = new Map<string, Bucket>();

export type RateLimitConfig = {
  /** Max requests allowed per window. */
  capacity: number;
  /** Window length in ms. */
  refillWindowMs: number;
};

/**
 * Anonymous submissions: 5 per minute. Exported unchanged (and still the
 * default for `consumeToken`) so the contribution flow keeps its exact limits.
 */
export const RATE_LIMIT: RateLimitConfig = { capacity: 5, refillWindowMs: 60_000 };

/** Per-namespace ceilings. */
export const RATE_LIMITS = {
  submissions: RATE_LIMIT,
  /** Capture sessions: 3 per hour per origin. Mirrored by 0013's DB-side check. */
  capture: { capacity: 3, refillWindowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitNamespace = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  /** Whole tokens left after this check. */
  remaining: number;
  /** Seconds until at least one token refills (0 when tokens remain). */
  retryAfterSec: number;
};

/**
 * Consume one token for `key` in `namespace`. Refills continuously at
 * `capacity / refillWindowMs` tokens per ms. A `null` key (no derivable IP,
 * e.g. local direct request) is not rate-limited.
 */
export function consumeNamespacedToken(
  namespace: RateLimitNamespace,
  key: string | null,
  now = Date.now(),
): RateLimitResult {
  const { capacity, refillWindowMs } = RATE_LIMITS[namespace];
  if (!key) return { allowed: true, remaining: capacity, retryAfterSec: 0 };

  // Namespaced so the capture ceiling and the submissions ceiling never draw
  // from the same bucket for one origin.
  const bucketKey = `${namespace}:${key}`;
  const ratePerMs = capacity / refillWindowMs;

  const bucket = BUCKETS.get(bucketKey) ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + elapsed * ratePerMs);

  if (tokens < 1) {
    BUCKETS.set(bucketKey, { tokens, updatedAt: now });
    const retryAfterSec = Math.ceil((1 - tokens) / ratePerMs / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  const nextTokens = tokens - 1;
  BUCKETS.set(bucketKey, { tokens: nextTokens, updatedAt: now });
  return { allowed: true, remaining: Math.floor(nextTokens), retryAfterSec: 0 };
}

/**
 * Consume one submissions token for `key`. The original entry point, kept
 * byte-for-byte in behaviour: the contribution route calls this and its limits
 * are unchanged.
 */
export function consumeToken(key: string | null, now = Date.now()): RateLimitResult {
  return consumeNamespacedToken("submissions", key, now);
}

/** Test/maintenance helper: clear all buckets, in every namespace. */
export function resetRateLimits(): void {
  BUCKETS.clear();
}
