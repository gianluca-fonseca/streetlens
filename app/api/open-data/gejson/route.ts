/**
 * GET /api/open-data/gejson — mandate alias for /api/open-data/geojson
 * (brief typo preserved so the unit contract path resolves).
 */

import { loadOpenDataGeoJson } from "@/lib/open-data-pack";
import { showDemoData } from "@/lib/demo-flag";

export const runtime = "nodejs";

export async function GET() {
  // Build-time default, not the cookie: this response is shared-cached, so it
  // must not vary by one visitor's demo switch.
  const body = await loadOpenDataGeoJson(showDemoData());
  return Response.json(body, {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=900",
      "content-disposition": 'attachment; filename="streetlens-open-data.geojson"',
    },
  });
}
