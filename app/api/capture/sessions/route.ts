/**
 * POST /api/capture/sessions — open a capture session.
 *
 * STUB (u25): answers 501 with its contract. unit-capture-ingest implements the
 * body against this exact shape.
 *
 * Planned order of defense, mirroring /api/submissions: honeypot → rate limit
 * (the `capture` namespace, 3/hour/IP) → zod → `capture_create_session` RPC.
 * The RPC re-checks the same ceiling in the database, because the in-memory
 * bucket resets on every cold start (lib/rate-limit.ts says so itself).
 */

import { notImplemented } from "../contract";

// Node runtime: node:crypto for IP hashing, same as /api/submissions.
export const runtime = "nodejs";

export async function POST() {
  return notImplemented({
    endpoint: "POST /api/capture/sessions",
    summary: "Open a capture session and return the upload capability for it.",
    request: {
      mode: '"live" | "video"',
      honeypot: "string — must be empty; a value marks the caller a bot",
      contact: "string (optional) — never published",
    },
    response: {
      sessionId: "uuid — the capability: holding it authorizes acting on this session",
      uploadPrefix: "string — `captures/<sessionId>`",
      maxFrames: "number — 400",
      maxFrameBytes: "number — 2097152",
    },
    implementedBy: "unit-capture-ingest",
  });
}
