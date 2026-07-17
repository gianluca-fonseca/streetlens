/**
 * GET /api/capture/sessions/[id] — a contributor's view of their own session.
 *
 * STUB (u25): answers 501 with its contract. unit-capture-ingest implements the
 * body against this exact shape.
 *
 * Authorization is the session uuid itself: knowing it is what entitles you to
 * read it, and it entitles you to nothing else. The response deliberately
 * carries no ip hash, no contact and no raw track — `capture_session_status`
 * (0013) enforces that server-side rather than trusting this route to remember.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { notImplemented } from "../../contract";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return notImplemented({
    endpoint: `GET /api/capture/sessions/${id}`,
    summary: "Read your own session's progress by uuid.",
    response: {
      status:
        '"pending_upload" | "uploading" | "matching" | "extracting" | "cost_paused" | "review_ready" | "approved" | "rejected" | "failed"',
      frameCount: "number",
      jobs: "{ pending: number; done: number; failed: number }",
      rollups:
        "Array<{ segmentId, coverage, confidence, scores }> (optional — present from review_ready on)",
    },
    implementedBy: "unit-capture-ingest",
  });
}
