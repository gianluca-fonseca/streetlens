/**
 * GET /api/open-data/gejson — mandate alias for /api/open-data/geojson
 * (brief typo preserved so the unit contract path resolves).
 */

import { loadOpenDataGeoJson } from "@/lib/open-data-pack";

export const runtime = "nodejs";

export async function GET() {
  const body = await loadOpenDataGeoJson();
  return Response.json(body, {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=900",
      "content-disposition": 'attachment; filename="streetlens-open-data.geojson"',
    },
  });
}
