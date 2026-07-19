/**
 * GET /api/admin/qr-poster — printable bilingual QR poster HTML (admin only).
 */

import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { requireAdmin } from "@/lib/admin-auth";
import { buildQrPosterHtml } from "@/lib/capture/qr-poster";
import { getSegmentBrief } from "@/lib/capture/segment-brief";
import { collectDeepLinkUrl } from "@/lib/capture/collect-deep-link";
import { getMunicipalityConfig } from "@/lib/municipality";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const spot = request.nextUrl.searchParams.get("spot")?.trim();
  const locale = request.nextUrl.searchParams.get("locale")?.trim() || "en";
  const origin = request.nextUrl.searchParams.get("origin")?.trim() || request.nextUrl.origin;

  if (!spot || spot.length > 64) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const brief = await getSegmentBrief(spot);
  if (!brief) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const collectUrl = collectDeepLinkUrl(spot, locale, origin);
  const qrSvg = await QRCode.toString(collectUrl, { type: "svg", margin: 1, width: 200 });
  const muni = getMunicipalityConfig();

  const html = buildQrPosterHtml({
    spotId: brief.id,
    streetName: brief.name,
    district: brief.district,
    collectUrl,
    qrSvg,
    municipality: muni.name,
    projectName: muni.projectName,
  });

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
