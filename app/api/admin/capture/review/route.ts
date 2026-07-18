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
import { requireAdmin } from "@/lib/admin-auth";
import { getSessionReview } from "@/lib/capture/review-store";
import { applyApprovedCaptureSession } from "@/lib/apply-submissions";
import { finalizeCaptureReview } from "@/lib/capture/review-actions";
import { revalidatePublicMapPages } from "@/lib/revalidate-map";
import {
  recomputeReview,
  EMPTY_CORRECTIONS,
  type ReviewCorrections,
} from "@/lib/capture/review-overrides";

export const runtime = "nodejs";

// A reviewer's corrections. Loosely typed on the wire (rubric/lens keys are checked
// by the recompute, which simply ignores anything it does not recognize) but bounded
// so a forged request cannot smuggle in a huge payload.
const itemMapSchema = z.record(
  z.string().max(64),
  z.record(z.string().max(64), z.number().nullable()),
);
const correctionsSchema = z.object({
  itemOverrides: itemMapSchema.default({}),
  excluded: z.array(z.number().int().nonnegative().max(100000)).max(2000).default([]),
  deleted: z.array(z.number().int().nonnegative().max(100000)).max(2000).default([]),
  manualScores: z
    .record(z.string().max(64), z.record(z.string().max(32), z.number().nullable()))
    .default({}),
  // Per segment, the lenses where the reviewer declined the synthesis adjustment.
  // Loosely typed on the wire; the recompute ignores any key it does not recognize.
  baselineLenses: z
    .record(z.string().max(64), z.array(z.string().max(32)).max(10))
    .default({}),
});

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
  /**
   * The reviewer's corrections. Optional — omitted means "the model's readings,
   * unchanged". The server RE-RUNS the recompute from the session's own frames, so
   * the numbers that land are the server's, not the client's; the client cannot
   * inject arbitrary scores.
   */
  corrections: correctionsSchema.optional(),
});

/** Normalize the wire shape (string seq keys) into the recompute's typed corrections. */
function toCorrections(input: z.infer<typeof correctionsSchema> | undefined): ReviewCorrections {
  if (!input) return EMPTY_CORRECTIONS;
  const itemOverrides: ReviewCorrections["itemOverrides"] = {};
  for (const [seq, over] of Object.entries(input.itemOverrides)) {
    itemOverrides[Number(seq)] = over as ReviewCorrections["itemOverrides"][number];
  }
  return {
    itemOverrides,
    excluded: input.excluded,
    deleted: input.deleted,
    manualScores: input.manualScores as ReviewCorrections["manualScores"],
    baselineLenses: input.baselineLenses as ReviewCorrections["baselineLenses"],
  };
}

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

  // The authoritative recompute. Run from the session's OWN frames with the
  // reviewer's corrections applied, reusing the same rollup math as the server —
  // so what lands is what the reviewer saw, and the client cannot inject scores.
  const corrections = toCorrections(parsed.data.corrections);
  const recompute = recomputeReview(review.frames, corrections, review.assessments);

  const surviving = new Map(recompute.segments.map((s) => [s.segmentId, s]));
  const dropped = new Set(recompute.droppedSegmentIds);

  // Implicit approve-all takes exactly the segments that still have supporting
  // frames; dropped ones simply do not land. An EXPLICIT list is validated harder.
  const approvedIds =
    action === "approve" ? (segment_ids ?? [...surviving.keys()]) : [];

  // Every explicitly-approved id must be a segment this session actually observed
  // (surviving or dropped). Otherwise a forged request could attach camera scores
  // to a segment id no frame ever saw.
  const observed = new Set([...surviving.keys(), ...dropped]);
  const unknown = approvedIds.filter((id) => !observed.has(id));
  if (unknown.length > 0) {
    return NextResponse.json({ error: "unknown_segments", unknown }, { status: 422 });
  }

  // A segment whose every supporting frame was excluded or deleted cannot be
  // approved: there is nothing behind it. (Implicit approve-all never hits this;
  // it only offers surviving segments.)
  const droppedApproved = approvedIds.filter((id) => dropped.has(id));
  if (droppedApproved.length > 0) {
    return NextResponse.json(
      { error: "dropped_segments", dropped: droppedApproved },
      { status: 422 },
    );
  }

  const chosen = approvedIds
    .map((id) => surviving.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

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
        frame_refs: s.frameRefs,
        human_corrected: s.humanCorrected,
        overrides: s.humanCorrected ? s.overrides : undefined,
        // The synthesis is context that rides along to the map (seal #3): the overall
        // verdict shown on the public popover. The chosen NUMBERS are still s.scores.
        assessment: s.assessment ?? undefined,
      })),
    });

    const closed = await finalizeCaptureReview({
      sessionId: session_id,
      action,
      reason,
    });

    if (action === "approve") {
      revalidatePublicMapPages();
    }

    return NextResponse.json({
      ok: true,
      status: action === "approve" ? "approved" : "rejected",
      applied: chosen.length,
      corrected: chosen.filter((s) => s.humanCorrected).length,
      mode: closed.mode,
    });
  } catch (err) {
    // Log before swallowing into an opaque server_error, so a prod failure (e.g. a
    // read-only FS or an RPC error) is diagnosable from the Vercel logs. Response
    // body is intentionally unchanged.
    console.error("[capture review] approve/reject failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
