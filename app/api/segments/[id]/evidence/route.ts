/**
 * GET /api/segments/[id]/evidence — short-lived signed URLs for the public
 * evidence strip. Same scrub discipline as /detail: no session_id, no raw
 * frame_refs on the wire — only opaque signed image URLs.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSegmentEvidence } from "@/lib/segment-evidence";
import { getSegmentDetail } from "@/lib/segments";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const segment = await getSegmentDetail(id);
  if (!segment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const evidence = await getSegmentEvidence(id);
  return NextResponse.json(evidence, {
    headers: {
      // Short cache: signed URLs expire; avoid serving stale tokens.
      "Cache-Control": "private, max-age=60",
    },
  });
}
