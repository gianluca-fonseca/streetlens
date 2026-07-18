/**
 * DELETE /api/admin/capture/frame — hard-delete one capture frame for privacy.
 *
 * Separate from the review approve route because it is a different kind of act: an
 * approval is a reversible, re-reviewable verdict; a delete is irreversible and
 * happens the moment a reviewer asks, before any approval. It removes the stored
 * bytes and rows through the secret-gated definer RPC (0021), the strongest honest
 * deletion this deployment allows.
 *
 * AUTHORIZATION IS RE-CHECKED HERE. proxy.ts does not guard /api, so every admin
 * route verifies the session cookie itself.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteCaptureFrame } from "@/lib/capture/review-actions";

export const runtime = "nodejs";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  seq: z.number().int().nonnegative().max(100000),
});

export async function DELETE(request: NextRequest) {
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

  try {
    const result = await deleteCaptureFrame({
      sessionId: parsed.data.session_id,
      seq: parsed.data.seq,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Log before swallowing into an opaque server_error, so a prod delete failure
    // is diagnosable from the Vercel logs. Response body is intentionally unchanged.
    console.error("[capture frame] delete failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
