/**
 * Secret gate for /api/ops/health — separate from admin session cookies so
 * external monitors can curl a single bearer token without admin UI access.
 */

import { timingSafeEqual } from "../timing-safe";

export function opsHealthSecret(): string | undefined {
  return process.env.OPS_HEALTH_SECRET;
}

/** Accept Authorization: Bearer <secret> or ?secret= query param. */
export function verifyOpsHealthAuth(
  authorization: string | null,
  querySecret: string | null,
): boolean {
  const expected = opsHealthSecret();
  if (!expected) return false;

  if (querySecret && timingSafeEqual(querySecret, expected)) return true;

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token && timingSafeEqual(token, expected)) return true;
  }

  return false;
}
