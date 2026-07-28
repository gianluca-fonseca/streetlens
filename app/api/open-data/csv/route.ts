/**
 * GET /api/open-data/csv — scrubbed, bounded CSV of the published observed network.
 */

import { loadOpenDataCsv } from "@/lib/open-data-pack";
import { showDemoData } from "@/lib/demo-flag";

export const runtime = "nodejs";

export async function GET() {
  // The BUILD-TIME default, deliberately, not the per-browser cookie override:
  // this response is shared-cached (s-maxage below), so varying it by one
  // visitor's demo switch would serve their era to everyone else.
  const body = await loadOpenDataCsv(showDemoData());
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=900",
      "content-disposition": 'attachment; filename="streetlens-open-data.csv"',
    },
  });
}
