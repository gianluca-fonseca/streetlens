/**
 * POST /api/capture/sessions/[id]/finalize — close a session and hand it to the matcher.
 *
 * STUB (u25): answers 501 with its contract. unit-capture-ingest implements the
 * body against this exact shape.
 *
 * Finalizing attaches the track, enqueues one extraction job per registered
 * frame, and moves the session to `matching`. It is one-way: a finalized
 * session stops accepting frames and its track cannot be rewritten
 * (`capture_finalize_session`, 0013).
 *
 * `clockOffsetMs` is recorded, never applied to the fixes — the stored track
 * stays exactly what the device reported, and the correction is data.
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
    endpoint: `POST /api/capture/sessions/${id}/finalize`,
    summary: "Attach the track, enqueue extraction, and close the session to uploads.",
    request: {
      track: "TrackPoint[] — { lat, lng, t (epoch ms UTC), accuracy?, heading?, speed? }",
      source: '"live" | "gpx" | "trace"',
      clockOffsetMs:
        "number (optional, default 0) — trueTime = deviceTime + clockOffsetMs; recorded, not applied",
    },
    response: {
      status: '"matching" — the session\'s new status',
    },
    implementedBy: "unit-capture-ingest",
  });
}
