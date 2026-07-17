/**
 * POST /api/capture/sessions/[id]/frames — register frames before uploading them.
 *
 * THIS IS THE AUTHORIZATION STEP FOR THE STORAGE BUCKET, not bookkeeping, and
 * the ORDER IS THE SECURITY PROPERTY. The bucket admits an anonymous INSERT only
 * when a capture_frames row already exists for that exact path on a session that
 * still accepts uploads (the `capture_frames_anon_insert` policy, 0013 section
 * 4). So registration is what arms the upload: a client cannot invent a path,
 * cannot upload to a finalized session, and cannot walk past the frame ceiling
 * one batch at a time. Nothing reaches storage that did not come through here
 * first — which is also why this route must never be made to run after the
 * upload as a convenience.
 *
 * The path is DERIVED server-side from the seq (in the RPC, and re-checked by
 * the storage policy's regex). A client-supplied storagePath is validated
 * against the derived one and otherwise ignored.
 *
 * `accepted` returns every seq now on record, not just this batch's — that is
 * the client's resume cursor after a dropped connection.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  registerFramesRequestSchemaFor,
  type RegisterFramesResponse,
} from "@/lib/capture/schemas";
import { getCaptureDb } from "@/lib/capture/db";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // The schema is built FOR this session id, so it can check that every
  // storagePath is exactly the one the convention derives for its seq.
  const parsed = registerFramesRequestSchemaFor(id).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  let accepted: number[];
  try {
    accepted = await db.registerFrames(id, parsed.data.frames);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // The RPC's own gates, mapped to honest status codes. A finalized session or
    // a full one is the client's problem to handle (stop uploading), not a
    // server fault, so neither is a 500.
    if (/session not found/i.test(message)) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (/does not accept uploads/i.test(message)) {
      return NextResponse.json({ ok: false, error: "session_closed" }, { status: 409 });
    }
    if (/frame limit exceeded/i.test(message)) {
      return NextResponse.json({ ok: false, error: "frame_limit" }, { status: 413 });
    }
    console.error("[capture] register frames failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }

  const response: RegisterFramesResponse = { accepted };
  return NextResponse.json(response, { status: 200 });
}
