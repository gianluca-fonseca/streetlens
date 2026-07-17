/**
 * POST /api/capture/sessions/[id]/pump — move MY walk forward, and only mine.
 *
 * This is the route app/api/capture/pump/route.ts prescribes in its note to this
 * unit: the contributor's status page needs extraction to progress while they
 * watch (the cron runs once a day, at 03:00 — without this a Hobby-plan walk that
 * finalize's after() did not finish draining sits untouched for hours), but the
 * global pump takes ADMIN_RPC_SECRET and a browser cannot hold one. That note
 * rules the answer is "a separate route scoped and rate limited to one session by
 * its uuid, never this one opened up". This is that route.
 *
 * WHAT AUTHORIZES IT: the session uuid, exactly as for GET status and the frame
 * uploads. Knowing the uuid entitles you to act on that session and nothing else.
 * The ADMIN_RPC_SECRET stays server-side, where it always was: this route holds
 * it to call the RPC, the browser never sees it.
 *
 * WHY IT CANNOT BECOME THE EXPENSIVE MISTAKE the global pump warns about:
 *   - the claim is scoped in SQL (capture_claim_jobs_for_session, 0017), not by
 *     this route remembering to filter, so a link-holder cannot reach another
 *     session's frames even if this file is wrong;
 *   - the spend it can cause is bounded by the frames already uploaded to that
 *     one session, which the cron would bill anyway — it moves the bill earlier,
 *     it does not create one;
 *   - the per-frame ceiling, per-session budget, escalation cap and kill switch
 *     in the pump all still apply, unchanged;
 *   - it only claims while the session is `extracting`, so polling can never
 *     resurrect a cost_paused walk (that is a human's decision), and
 *   - it is rate limited per session.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCaptureDb } from "@/lib/capture/db";
import { pumpOnce } from "@/lib/capture/pump";
import { consumeNamespacedToken } from "@/lib/rate-limit";

export const runtime = "nodejs";

// A contributor's poll claims a small batch, not the cron's 40: this runs while
// somebody is watching a spinner, and a 300s hold would look like a hang.
const SESSION_PUMP_BATCH = 6;
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  // Keyed by session, not IP: the budget being protected belongs to the walk, and
  // a contributor on mobile data can change IP between polls.
  const limit = consumeNamespacedToken("capturePump", id);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  try {
    // Confirm the session exists before spending anything. This also makes the
    // route honest for an unknown uuid rather than reporting a cheerful zero.
    const status = await db.sessionStatus(id);

    // Only an extracting session is claimable. Saying so here (rather than
    // letting the scoped claim return nothing) keeps the client's contract
    // meaningful: `remaining` is about work, not about being refused.
    if (status.status !== "extracting") {
      return NextResponse.json(
        { ok: true, claimed: 0, done: 0, failed: 0, remaining: status.jobs.pending, status: status.status },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const result = await pumpOnce({ db, sessionId: id, limit: SESSION_PUMP_BATCH });

    // pumpOnce's `remaining` is the GLOBAL pending count, which is the right
    // answer for the cron and the wrong one here: it would have this contributor's
    // page keep polling (and paying) until everybody else's backlog drained too.
    // Re-read the session so `remaining` means "work left on YOUR walk".
    const after = await db.sessionStatus(id);
    return NextResponse.json(
      {
        ok: true,
        claimed: result.claimed,
        done: result.done,
        failed: result.failed,
        remaining: after.jobs.pending,
        status: after.status,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
