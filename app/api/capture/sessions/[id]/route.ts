/**
 * GET /api/capture/sessions/[id] — a contributor's view of their own session.
 *
 * Authorization is the session uuid itself: knowing it is what entitles you to
 * read it, and it entitles you to nothing else. The response carries no ip hash,
 * no contact and no raw track — `capture_session_status` (0013) enforces that
 * server-side by selecting only these columns, rather than trusting this route
 * to remember not to leak them.
 *
 * CHEAP AND SIDE-EFFECT FREE. This is a polling endpoint: the status page hits
 * it every few seconds while a capture extracts. It is one RPC and it starts no
 * work. It deliberately does NOT pump — a pump here would put an unbounded model
 * bill behind a GET that any link-holder can hold open in a tab, and refreshing
 * a status page must never spend money. The client pumps by POSTing
 * /api/capture/pump, which is gated.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCaptureDb } from "@/lib/capture/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  try {
    const status = await db.sessionStatus(id);

    // The RPC always returns a rollups array; the contract says the field is
    // present only once there are rollups to show. An empty array would read to
    // a client as "extraction finished and found nothing", which is a different
    // claim from "not ready yet".
    const body =
      status.rollups && status.rollups.length > 0
        ? status
        : { status: status.status, frameCount: status.frameCount, jobs: status.jobs };

    return NextResponse.json(body, {
      status: 200,
      // A poll must never be served from a cache: the whole point is that the
      // answer changes.
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    console.error("[capture] session status failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
