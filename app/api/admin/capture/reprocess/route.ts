/**
 * POST /api/admin/capture/reprocess — re-run map matching (dry-run or commit).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { getCaptureDb } from "@/lib/capture/db";
import { reprocessSession } from "@/lib/capture/reprocess-session";

export const runtime = "nodejs";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  dry_run: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

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

  const { session_id, dry_run } = parsed.data;

  try {
    const result = await reprocessSession({
      db,
      sessionId: session_id,
      dryRun: dry_run ?? false,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already decided/i.test(message)) {
      return NextResponse.json({ error: "already_decided" }, { status: 409 });
    }
    if (/not reprocessable|no usable track|no frames/i.test(message)) {
      return NextResponse.json({ error: "not_reprocessable", detail: message }, { status: 409 });
    }
    console.error("[capture reprocess] failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
