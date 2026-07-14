/**
 * Minimal per-key token bucket for anonymous submission throttling.
 *
 * LIMITATION (documented, intentional for MVP): this bucket lives in module
 * memory. It is per-serverless-instance and resets on redeploy or cold start,
 * so it slows casual abuse but is not a hard guarantee across a fleet. The
 * seam is deliberate — swap this module for a Redis / Postgres counter later
 * without touching the route. Keyed by the hashed IP (never a raw IP).
 */

type Bucket = { tokens: number; updatedAt: number };

const BUCKETS = new Map<string, Bucket>();

/** Max submissions allowed per window, and the window length in ms. */
export const RATE_LIMIT = { capacity: 5, refillWindowMs: 60_000 } as const;

export type RateLimitResult = {
  allowed: boolean;
  /** Whole tokens left after this check. */
  remaining: number;
  /** Seconds until at least one token refills (0 when tokens remain). */
  retryAfterSec: number;
};

/**
 * Consume one token for `key`. Refills continuously at
 * `capacity / refillWindowMs` tokens per ms. A `null` key (no derivable IP,
 * e.g. local direct request) is not rate-limited.
 */
export function consumeToken(key: string | null, now = Date.now()): RateLimitResult {
  if (!key) return { allowed: true, remaining: RATE_LIMIT.capacity, retryAfterSec: 0 };

  const { capacity, refillWindowMs } = RATE_LIMIT;
  const ratePerMs = capacity / refillWindowMs;

  const bucket = BUCKETS.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(capacity, bucket.tokens + elapsed * ratePerMs);

  if (tokens < 1) {
    BUCKETS.set(key, { tokens, updatedAt: now });
    const retryAfterSec = Math.ceil((1 - tokens) / ratePerMs / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  const nextTokens = tokens - 1;
  BUCKETS.set(key, { tokens: nextTokens, updatedAt: now });
  return { allowed: true, remaining: Math.floor(nextTokens), retryAfterSec: 0 };
}

/** Test/maintenance helper: clear all buckets. */
export function resetRateLimits(): void {
  BUCKETS.clear();
}
