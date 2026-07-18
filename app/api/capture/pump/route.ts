/**
 * POST /api/capture/pump — drive the extraction queue one batch forward.
 *
 * A pull-based pump rather than a background worker: serverless has no
 * long-lived process, so something calls this and it claims a bounded batch,
 * extracts, and returns. `remaining` is how the caller knows to call again.
 *
 * WHO CALLS IT: finalize's after(), the daily cron in vercel.json, or an
 * operator. Claiming uses FOR UPDATE SKIP LOCKED
 * (`capture_claim_jobs_with_frames`, 0015), so those racing is the ordinary case
 * and never double-bills a frame.
 *
 * GATED, BECAUSE IT SPENDS MONEY. Every call can bill up to 40 model requests,
 * so this is the one capture endpoint that is not anonymous: it takes
 * ADMIN_RPC_SECRET (or Vercel's CRON_SECRET). A capture session's uuid does NOT
 * authorize it — the uuid capability is a licence to act on your own session,
 * not to start work on the whole queue.
 *
 * NOTE FOR THE STATUS-PAGE UNIT: the seed for this unit imagined the
 * contributor's status polling pumping too, and it cannot — a browser cannot
 * hold this secret, and putting an unbounded model bill behind an anonymous
 * endpoint would be the single most expensive mistake available in this repo.
 * The after() kick plus the cron already drain the queue. If client-driven
 * pumping turns out to be needed, it wants a separate route scoped and rate
 * limited to one session by its uuid, never this one opened up.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { pumpOnce } from "@/lib/capture/pump";
import { PUMP_BATCH_SIZE } from "@/lib/extraction/config";

export const runtime = "nodejs";

// Model calls are slow and this claims a batch of them. Vercel's default (10s)
// would kill a full batch mid-flight, leaving jobs stuck `running`. The claim
// RPCs reclaim stale `running` rows (>10 min) before each claim (0025), so a
// timeout does not strand a session forever.
export const maxDuration = 300;

const pumpRequestSchema = z.object({
  limit: z.int().min(1).max(PUMP_BATCH_SIZE).optional(),
});

/** Constant-time compare, so this cannot be brute-forced a byte at a time. */
function secretsMatch(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Authorize a pump call.
 *
 * Accepts ADMIN_RPC_SECRET (operator, after()-internal callers) or CRON_SECRET
 * (what Vercel Cron sends as `Authorization: Bearer`). Fails closed when neither
 * is configured: an unset secret must never mean "everyone may spend money".
 */
function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || request.headers.get("x-admin-rpc-secret") || "";
  if (!provided) return false;

  const candidates = [process.env.ADMIN_RPC_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  if (candidates.length === 0) return false;

  return candidates.some((secret) => secretsMatch(provided, secret));
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // An absent body is normal — the cron sends none.
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = pumpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await pumpOnce({ limit: parsed.data.limit });
    return NextResponse.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[capture] pump failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
