/**
 * GET /api/routing-network — serves the committed street-following routing
 * graph (data/routing-network.geojson) to the client trace tool.
 *
 * The asset is a build artifact of scripts/build-routing-graph.mjs: every
 * routable OSM way in the pilot bbox as a LineString, with shared node
 * coordinates preserving topology so geojson-path-finder can route (and turn)
 * through intersections. It is fetched lazily on first use of "Follow streets"
 * so the initial map payload stays lean, and it is immutable content (a new
 * graph means a new deploy), hence the long immutable cache.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// Node runtime: we read the asset off disk with node:fs.
export const runtime = "nodejs";

const NETWORK_PATH = path.join(process.cwd(), "data", "routing-network.geojson");

export async function GET() {
  try {
    const body = await fs.readFile(NETWORK_PATH, "utf8");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/geo+json; charset=utf-8",
        // Immutable: the graph only changes when the asset is rebuilt + redeployed.
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "routing_network_unavailable" },
      { status: 500 },
    );
  }
}
