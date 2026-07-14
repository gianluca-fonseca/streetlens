import { NextResponse, type NextRequest } from "next/server";
import {
  checkPassword,
  checkRateLimit,
  clearRateLimit,
  createSessionToken,
  recordFailedAttempt,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionCookieOptions,
} from "@/lib/admin-auth";

// Session signing uses Web Crypto; run on the Node.js runtime for parity with
// the other admin route handlers.
export const runtime = "nodejs";

function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** POST /api/admin/login — exchange the shared password for a session cookie. */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  let password: unknown;
  try {
    const body = (await request.json()) as { password?: unknown };
    password = body.password;
  } catch {
    password = undefined;
  }

  if (!checkPassword(password)) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  clearRateLimit(ip);
  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(SESSION_MAX_AGE),
  );
  return response;
}
