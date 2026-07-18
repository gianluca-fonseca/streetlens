/**
 * GET /api/segments/[id]/detail — bounded, scrubbed panel detail for one segment.
 *
 * Loaded on map click; the paint FeatureCollection carries only ids, casings,
 * cv_count, and canonical score stubs. This endpoint returns community reports
 * and CV observations with session_id / frame_refs stripped (frame_count only).
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
  return NextResponse.json(detail, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
