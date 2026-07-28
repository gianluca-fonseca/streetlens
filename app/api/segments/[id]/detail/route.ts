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
 * click, for one segment, it costs nothing.
 *
 * ## Why this route reads the cookie, when its wave-1 siblings do not
 *
 * The wave-1 rule was that a shared, CDN-cached surface takes the BUILD-TIME
 * default, because one browser's `sl_demo_data` cookie must never decide what
 * the next visitor is served. That rule was written when `getSegmentDetail` was
 * called here purely as an existence check and nothing off it reached the body.
 *
 * It now carries the audit, which is prose. A number the viewer's own chrome
 * suppresses is one thing; simulated crew testimony served to a browser that has
 * switched the pilot dataset OFF is another, and "it is public open data anyway"
 * answers the wrong question. The dataset being published is not a licence to
 * hand it to a client that asked for the real-data era. So the era is resolved
 * per request here, from the same cookie and through the same `resolveDemoData`
 * every other gated surface uses.
 *
 * The caching invariant is kept rather than traded away:
 *
 *  - `Vary: Cookie` so a shared cache can never hand one era's body to the other
 *    era's request. Without it, gating the body would be a cache-poisoning bug.
 *  - A request carrying an EXPLICIT override opts out of shared caching entirely
 *    (`private, no-store`). A per-browser answer is never written to a shared
 *    cache in the first place, which is the wave-1 concern stated exactly.
 *  - A request with no override still gets `public, s-maxage=60`. That is the
 *    common case (a first-time visitor on the demo default) and it is unchanged,
 *    so the CDN keeps working for the traffic the CDN was there for.
 *
 * Existence is NOT era-dependent, and that is load-bearing: `hideDemoAudit`
 * nulls fields on a segment, it never makes one disappear, so `getSegmentDetail`
 * returns null for exactly the same unknown ids in both eras. Reading the cookie
 * here cannot turn a 200 into a 404 for anyone. `scripts/test-field-notes.mjs`
 * locks that.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_DATA_COOKIE,
  DEMO_DATA_OFF,
  DEMO_DATA_ON,
  resolveDemoData,
} from "@/lib/demo-flag";
import { getSegmentMapDetail } from "@/lib/segment-map-detail";
import { getSegmentDetail } from "@/lib/segments";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const override = request.cookies.get(DEMO_DATA_COOKIE)?.value ?? null;
  const hasOverride = override === DEMO_DATA_ON || override === DEMO_DATA_OFF;
  const demoEnabled = resolveDemoData(override);

  // Community reports and CV observations below are real work in either era and
  // are read separately; the era governs only `audit`, which is the generated
  // pilot rubric. A live Supabase segment returns before the gate in
  // getSegmentDetail, so a real audit is never stripped by the demo switch.
  const segment = await getSegmentDetail(id, demoEnabled);
  if (!segment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const detail = await getSegmentMapDetail(id);
  return NextResponse.json(
    { ...detail, audit: segment.audit },
    {
      headers: {
        "Cache-Control": hasOverride
          ? "private, no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
        Vary: "Cookie",
      },
    },
  );
}
