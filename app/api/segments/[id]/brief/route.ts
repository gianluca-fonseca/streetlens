/**
 * GET /api/segments/[id]/brief — public segment name + district + bbox only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSegmentBrief } from "@/lib/capture/segment-brief";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const brief = await getSegmentBrief(id);
  if (!brief) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(brief, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
