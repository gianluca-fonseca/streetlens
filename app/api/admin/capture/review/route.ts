/**
 * POST /api/admin/capture/review — approve or reject a reviewed capture session.
 *
 * Its own route rather than /api/admin/review because the decision has a
 * different shape: a capture is approved PER SEGMENT (an admin takes the segments
 * the camera got right and leaves the rest), which the submission review's
 * one-row-one-verdict signature cannot express. reviewSubmission refuses a
 * cv_capture outright for the same reason.
 *
 * AUTHORIZATION IS RE-CHECKED HERE. proxy.ts matches
 * `/((?!api|trpc|_next|_vercel|.*\\..*).*)` — it does not guard /api at all, so
 * every admin route verifies the session cookie itself. There is no middleware
 * standing behind this.
 *
 * A reason is mandatory, exactly as it is for a manual submission: an approval
 * that lands camera scores on the public map with no recorded justification is
 * not a review.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { getSessionReview } from "@/lib/capture/review-store";
import { applyApprovedCaptureSession } from "@/lib/apply-submissions";
import { finalizeCaptureReview } from "@/lib/capture/review-actions";

export const runtime = "nodejs";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).max(1000),
  /**
   * The segments approved this time. Omitted on reject. An explicit empty array
   * is NOT the same as omitted: it means "none of them", which is a real verdict
   * and retracts anything previously approved.
   */
  segment_ids: z.array(z.string().min(1).max(64)).optional(),
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
  const { session_id, action, reason, segment_ids } = parsed.data;

  const review = await getSessionReview(session_id);
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Only a session waiting on a human may be decided. Without this, a double
  // submit (or a stale tab) would re-decide a closed session and re-publish
  // observations an admin had already retracted.
  if (review.status !== "review_ready") {
    return NextResponse.json(
      { error: "not_reviewable", status: review.status },
      { status: 409 },
    );
  }

  const approvedIds = action === "approve" ? (segment_ids ?? review.segments.map((s) => s.segmentId)) : [];

  // Every id must be one this session actually observed. Otherwise an admin (or a
  // forged request) could attach camera scores to an arbitrary segment id that no
  // frame ever saw.
  const known = new Set(review.segments.map((s) => s.segmentId));
  const unknown = approvedIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return NextResponse.json({ error: "unknown_segments", unknown }, { status: 422 });
  }

  const chosen = review.segments.filter((s) => approvedIds.includes(s.segmentId));

  try {
    // Land the data FIRST, then close the session — the same ordering rule
    // reviewSubmission follows, so a write failure never leaves an "approved"
    // session whose observations were never applied.
    await applyApprovedCaptureSession({
      session_id,
      submission_id: null,
      captured_on: review.capturedOn ?? new Date().toISOString(),
      observations: chosen.map((s) => ({
        segment_id: s.segmentId,
        scores: {
          overall: s.scores.overall ?? null,
          accessibility: s.scores.accessibility ?? null,
          drainage: s.scores.drainage ?? null,
          shade: s.scores.shade ?? null,
          bike: s.scores.bike ?? null,
        },
        item_medians: s.itemMedians,
        coverage: s.coverage ?? 0,
        confidence: s.confidence,
        frame_refs: s.frames.map((f) => f.storagePath),
      })),
    });

    const closed = await finalizeCaptureReview({
      sessionId: session_id,
      action,
      reason,
    });

    return NextResponse.json({
      ok: true,
      status: action === "approve" ? "approved" : "rejected",
      applied: chosen.length,
      mode: closed.mode,
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
