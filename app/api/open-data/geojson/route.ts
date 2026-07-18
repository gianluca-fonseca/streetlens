/**
 * GET /api/open-data/geojson — scrubbed, bounded GeoJSON of the published
 * observed network (paint-safe properties; no session/frame/contact fields).
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
