/**
 * POST /api/capture/pump — drive the extraction queue one batch forward.
 *
 * STUB (u25): answers 501 with its contract. unit-frame-extraction implements
 * the body against this exact shape.
 *
 * A pull-based pump rather than a background worker: serverless has no
 * long-lived process, so something (a cron, the review UI, an operator) calls
 * this and it claims a bounded batch, extracts, and returns. `remaining` is how
 * the caller knows whether to call again.
 *
 * Claiming uses FOR UPDATE SKIP LOCKED (`capture_claim_jobs`, 0013), so two
 * pumps racing take disjoint work instead of both paying a model for the same
 * frame. This endpoint spends money, so the implementing unit must gate it on
 * ADMIN_RPC_SECRET and respect the budget ceiling (`cost_paused`).
 */

import { notImplemented } from "../contract";

export const runtime = "nodejs";

export async function POST() {
  return notImplemented({
    endpoint: "POST /api/capture/pump",
    summary:
      "Claim and extract a bounded batch of pending frame jobs. Call again while remaining > 0.",
    request: {
      limit: "number (optional) — max jobs to claim this call",
    },
    response: {
      claimed: "number — jobs taken this call",
      done: "number — extracted successfully",
      failed: "number — includes failed_overbudget, which is retryable",
      remaining: "number — pending jobs left; call again while > 0",
    },
    implementedBy: "unit-frame-extraction",
  });
}
