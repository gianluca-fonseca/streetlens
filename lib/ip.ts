/**
 * Client-IP derivation and one-way hashing for the submissions queue.
 *
 * We NEVER store a raw IP. The submissions table keeps only `source_ip_hash`
 * so an admin can spot abuse patterns (many proposals from one origin) without
 * the queue becoming a log of who visited. The salt makes the hash useless
 * outside this deployment; set `SUBMISSIONS_IP_SALT` in production.
 */

import { createHash } from "node:crypto";

/**
 * Best-effort client IP from proxy headers. Vercel/most hosts set
 * `x-forwarded-for` (comma-separated, client first) or `x-real-ip`.
 * Returns `null` when nothing usable is present (e.g. local direct hits).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

/**
 * One-way, salted SHA-256 of an IP. Returns `null` for a null IP so callers
 * can store `null` rather than a hash of the empty string.
 */
function submissionsIpSalt(): string {
  const salt = process.env.SUBMISSIONS_IP_SALT;
  if (salt) return salt;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SUBMISSIONS_IP_SALT is required in production");
  }
  return "streetlens-dev-salt";
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${submissionsIpSalt()}:${ip}`).digest("hex");
}
