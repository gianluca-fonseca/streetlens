/**
 * GET /api/ops/health — secret-gated pipeline health for external monitors.
 *
 * Authorization: Bearer OPS_HEALTH_SECRET or ?secret= query param.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyOpsHealthAuth } from "@/lib/ops/health-auth";
import { getOpsHealth } from "@/lib/ops/ops-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (!verifyOpsHealthAuth(auth, querySecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const health = await getOpsHealth();
  if (!health) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    ...health,
  });
}
