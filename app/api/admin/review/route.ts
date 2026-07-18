import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { reviewSubmission } from "@/lib/submissions";
import { revalidatePublicMapPages } from "@/lib/revalidate-map";

// Uses fs (local fallback) + Web Crypto (session verify): Node.js runtime.
export const runtime = "nodejs";

/**
 * POST /api/admin/review — approve or reject a pending submission.
 *
 * Re-verifies the session cookie independently of the proxy guard (the proxy
 * matcher excludes /api; auth must be enforced in the handler). A reason is
 * required for both actions.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: { id?: unknown; action?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const { id, action, reason } = body;
  if (typeof id !== "string" || typeof action !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = await reviewSubmission(
    id,
    action,
    typeof reason === "string" ? reason : "",
  );

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 422;
    return NextResponse.json({ error: result.error }, { status });
  }

  if (action === "approve") {
    revalidatePublicMapPages();
  }

  return NextResponse.json(result);
}
