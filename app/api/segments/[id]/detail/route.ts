/**
 * GET /api/segments/[id]/detail — bounded, scrubbed panel detail for one segment.
 *
 * Loaded on map click; the paint FeatureCollection carries only ids, casings,
 * cv_count, and canonical score stubs. This endpoint returns community reports
 * and CV observations with session_id / frame_refs stripped (frame_count only),
 * plus the segment's rubric audit: the crew's per-item answers and the bilingual
 * field notes attached to them.
 *
 * The audit rides here rather than on the paint wire deliberately. It is ~15
 * observations per segment and the notes are prose, which is exactly the kind of
 * payload the map-payload diet exists to keep off the FeatureCollection; on a
 * click, for one segment, it costs nothing. Everything in it is already public
 * open data (data/demo-audits.json ships in the repo and in the export), so
 * there is nothing to scrub.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSegmentMapDetail } from "@/lib/segment-map-detail";
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

  const detail = await getSegmentMapDetail(id);
  return NextResponse.json({ ...detail, audit: segment.audit }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
