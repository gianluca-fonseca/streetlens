/**
 * POST /api/admin/capture/resume — resume a cost_paused capture session.
 *
 * Operator action: flips the session back to extracting, requeues failed_overbudget
 * jobs, and records who resumed and why (capture_resume_cost_paused, 0025).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { getCaptureDb } from "@/lib/capture/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
  actor: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { session_id, reason } = parsed.data;
  const actor = parsed.data.actor ?? "admin";

  try {
    const result = await db.resumeCostPaused(session_id, actor, reason);
    return NextResponse.json({
      ok: true,
      session_id,
      status: "extracting",
      requeued: result.requeued,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not cost_paused/i.test(message)) {
      return NextResponse.json({ error: "not_cost_paused" }, { status: 409 });
    }
    if (/session not found/i.test(message)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[capture resume] failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
