/**
 * GET /api/open-data/csv — scrubbed, bounded CSV of the published observed network.
 */

import { loadOpenDataCsv } from "@/lib/open-data-pack";

export const runtime = "nodejs";

export async function GET() {
  const body = await loadOpenDataCsv();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=900",
      "content-disposition": 'attachment; filename="streetlens-open-data.csv"',
    },
  });
}
