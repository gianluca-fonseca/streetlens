/**
 * POST /api/submissions — anonymous contribution intake.
 *
 * Order of defense: honeypot → rate limit → zod validation → persist. Every
 * accepted submission lands as `status='pending'`; nothing here writes to
 * segments or audits. Validation reuses lib/schemas.ts (the same schemas the
 * client validates against), so the contract has a single source of truth.
 *
 * RATE-LIMIT LIMITATION (MVP, intentional): the per-IP throttle is an
 * in-memory token bucket (lib/rate-limit.ts). It is per-serverless-instance
 * and resets on redeploy / cold start, so it slows casual abuse but is not a
 * fleet-wide guarantee. Swap that module for a Redis / Postgres counter to
 * harden it — the route does not change.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { submissionSchema } from "@/lib/schemas";
import { clientIpFromHeaders, hashIp } from "@/lib/ip";
import { consumeToken } from "@/lib/rate-limit";
import { persistSubmission } from "@/lib/submissions-sink";

// Node runtime: we use node:crypto (IP hashing) and node:fs (local queue).
export const runtime = "nodejs";

export async function POST(request: Request) {
  const ipHash = hashIp(clientIpFromHeaders(request.headers));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  // 1) Honeypot. A hidden field that a human never fills. If it carries any
  // value, treat the request as a bot: reject, and record the trip (flagged,
  // NOT pending) so admins can see abuse without it polluting the review queue.
  const honeypot =
    typeof (body as { honeypot?: unknown })?.honeypot === "string"
      ? ((body as { honeypot: string }).honeypot as string)
      : "";
  if (honeypot.trim().length > 0) {
    const type = (body as { type?: unknown })?.type;
    await persistSubmission({
      type: type === "update_segment" ? "update_segment" : "add_segment",
      payload: { rejected: "honeypot" },
      status: "rejected",
      source_ip_hash: ipHash,
      honeypot_tripped: true,
    });
    return NextResponse.json(
      { ok: false, error: "rejected" },
      { status: 400 },
    );
  }

  // 2) Rate limit (per hashed IP; in-memory token bucket — see lib/rate-limit).
  const rl = consumeToken(ipHash);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // 3) Validate the envelope with the shared zod schemas.
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  // 4) Persist as pending (Supabase when configured, else local queue).
  const { type, payload } = parsed.data;
  const result = await persistSubmission({
    type,
    payload,
    status: "pending",
    source_ip_hash: ipHash,
    honeypot_tripped: false,
  });

  return NextResponse.json(
    { ok: true, status: "pending", sink: result.sink },
    { status: 201 },
  );
}
