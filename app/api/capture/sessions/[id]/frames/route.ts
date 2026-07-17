/**
 * POST /api/capture/sessions/[id]/frames — register frames before uploading them.
 *
 * STUB (u25): answers 501 with its contract. unit-capture-ingest implements the
 * body against this exact shape.
 *
 * This is the AUTHORIZATION step for the storage bucket, not bookkeeping. The
 * bucket's insert policy (0013) only admits an object whose path already has a
 * registered `capture_frames` row on a session that still accepts uploads, so
 * nothing reaches storage that did not come through here first. The path is
 * derived server-side from the seq; a client-supplied path is ignored.
 *
 * `accepted` returns every seq now on record, not just this batch's — that is
 * the client's resume cursor after a dropped connection.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { notImplemented } from "../../../contract";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return notImplemented({
    endpoint: `POST /api/capture/sessions/${id}/frames`,
    summary:
      "Register frame metadata, authorizing the direct-to-storage uploads that follow.",
    request: {
      frames:
        "CaptureFrameMeta[] — { seq, t, storagePath, width, height, bytes, blurScore? }",
    },
    response: {
      accepted:
        "number[] — every seq now registered for this session (the resume cursor)",
    },
    implementedBy: "unit-capture-ingest",
  });
}
