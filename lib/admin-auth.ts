/**
 * Admin auth — password gate + signed session, no accounts.
 *
 * There is deliberately no user table and no service-role key. Access to
 * `/admin` is a single shared password (`ADMIN_PASSWORD`). A successful login
 * mints a short-lived HMAC-signed cookie; every admin surface (the `proxy`
 * guard AND each `/api/admin` route handler) re-verifies it.
 *
 * All crypto goes through the Web Crypto API (`crypto.subtle`) so this module
 * works unchanged in the proxy runtime and in route handlers. No `node:crypto`,
 * no `fs`.
 */

const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

/** Cookie name for the signed admin session. */
export const SESSION_COOKIE = "sl_admin_session";

/* ------------------------------------------------------------------ *
 * base64url helpers (binary-safe, runtime-agnostic)
 * ------------------------------------------------------------------ */

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ *
 * Signing key (derived from ADMIN_PASSWORD)
 * ------------------------------------------------------------------ */

let cachedKey: Promise<CryptoKey> | null = null;

function adminPassword(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    throw new Error("ADMIN_PASSWORD is not configured");
  }
  return pw;
}

/** Derive an HMAC key from the admin password (SHA-256 of a namespaced secret). */
async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const material = encoder.encode(
      `${adminPassword()}:streetlens-admin-session-${SESSION_VERSION}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", material);
    return crypto.subtle.importKey(
      "raw",
      digest,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  })();
  return cachedKey;
}

async function sign(payloadB64: string): Promise<string> {
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadB64),
  );
  return bytesToB64url(new Uint8Array(sig));
}

/** Constant-time string comparison (avoids leaking length/content via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  // Compare against the longer length so we never early-return on mismatch.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

type SessionPayload = { exp: number };

/** Mint a signed session token valid for {@link SESSION_TTL_SECONDS}. */
export async function createSessionToken(): Promise<string> {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  const sig = await sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Verify a session token: signature valid AND not expired. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expectedSig: string;
  try {
    expectedSig = await sign(payloadB64);
  } catch {
    return false;
  }
  if (!timingSafeEqual(providedSig, expectedSig)) return false;

  try {
    const json = new TextDecoder().decode(b64urlToBytes(payloadB64));
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.exp !== "number") return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Constant-time check of a submitted password against `ADMIN_PASSWORD`. */
export function checkPassword(input: unknown): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  let expected: string;
  try {
    expected = adminPassword();
  } catch {
    return false;
  }
  return timingSafeEqual(input, expected);
}

/** Standard cookie attributes for the session cookie. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

/* ------------------------------------------------------------------ *
 * Login rate limiting (in-memory, per-IP)
 *
 * Caveat: this is per-process. On a serverless/multi-instance deployment it is
 * best-effort, not a global limiter. Sufficient as a brute-force speed bump for
 * a single shared password; a durable store (KV/Redis) is the post-DB upgrade.
 * ------------------------------------------------------------------ */

const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_ATTEMPTS = 8;

type RateEntry = { count: number; resetAt: number };
const attempts = new Map<string, RateEntry>();

/** Is this IP currently allowed to attempt a login? Does not mutate on read. */
export function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfter: number;
} {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Record a failed login attempt for an IP within the sliding window. */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/** Clear the rate-limit record for an IP (called on a successful login). */
export function clearRateLimit(ip: string): void {
  attempts.delete(ip);
}
