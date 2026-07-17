/**
 * POST /api/capture/sessions — open a capture session.
 *
 * Order of defense, mirroring /api/submissions: honeypot → rate limit (the
 * `capture` namespace, 3/hour/IP) → zod → `capture_create_session` RPC.
 *
 * The ceiling is enforced TWICE on purpose. lib/rate-limit.ts is an in-memory
 * bucket that resets on every cold start (it says so itself), so it is the cheap
 * fast path; capture_create_session re-checks the same 3/hour against the
 * database, and that is the one that actually holds fleet-wide. Opening a
 * session invites 400 image uploads and a model bill, which is why it is metered
 * far harder than a text submission.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionRequestSchema,
  type CreateSessionResponse,
} from "@/lib/capture/schemas";
import { CAPTURE_LIMITS, captureStoragePrefix } from "@/lib/capture/types";
import { getCaptureDb, RateLimitedError } from "@/lib/capture/db";
import { clientIpFromHeaders, hashIp } from "@/lib/ip";
import { consumeNamespacedToken } from "@/lib/rate-limit";

// Node runtime: node:crypto for IP hashing, same as /api/submissions.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const ipHash = hashIp(clientIpFromHeaders(request.headers));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // 1) Honeypot — a hidden field a human never fills.
  //
  // Checked before zod, and read WITHOUT coercion. `honeypot` is typed
  // `string().max(0)`, so a bot posting a non-string (honeypot: 1, or an object)
  // would fail zod as "invalid" and become indistinguishable from a genuine
  // client bug. Any present, non-empty value of any type is a bot. Same class of
  // problem as the u25 honeypot fix in /api/submissions, where type coercion was
  // quietly destroying the signal.
  //
  // Unlike /api/submissions, a trip records nothing: there is no session yet, so
  // there is no row to file it against, and creating one would put a bot in the
  // review queue.
  const honeypot = (body as { honeypot?: unknown })?.honeypot;
  const tripped =
    honeypot !== undefined &&
    honeypot !== null &&
    (typeof honeypot === "string" ? honeypot.trim().length > 0 : true);
  if (tripped) {
    return NextResponse.json({ ok: false, error: "rejected" }, { status: 400 });
  }

  // 2) Rate limit (per hashed IP, `capture` namespace — 3/hour).
  const rl = consumeNamespacedToken("capture", ipHash);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // 3) Validate.
  const parsed = createSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const db = getCaptureDb();
  if (!db) {
    // 503 rather than a fallback: unlike the map's read paths, there is no
    // static answer to "record my session".
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  // 4) Create. The RPC re-checks the per-origin ceiling in the database.
  let sessionId: string;
  try {
    sessionId = await db.createSession({
      mode: parsed.data.mode,
      ipHash,
      contact: parsed.data.contact,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
    console.error("[capture] create session failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  const response: CreateSessionResponse = {
    sessionId,
    uploadPrefix: captureStoragePrefix(sessionId),
    maxFrames: CAPTURE_LIMITS.maxFrames,
    maxFrameBytes: CAPTURE_LIMITS.maxFrameBytes,
  };

  return NextResponse.json(response, { status: 201 });
}
