/**
 * Closing a capture review: stamp the session, close its queue row (u30).
 *
 * Live mode does both in ONE transaction (`capture_close_review`, 0017), because
 * they are one decision. Split across two calls they could half-succeed and leave
 * a session `approved` whose cv_capture row sits pending forever, with the queue
 * and the session disagreeing about a walk and nothing to say which is right.
 *
 * Local mode is the overlay pattern this repo already uses for review state
 * (lib/submissions.ts keeps an immutable base plus data/submission-reviews.local.json).
 * The capture fixture is likewise immutable and gets its own overlay, so a local
 * drive of the whole loop — queue → review → approve → map — behaves like the real
 * thing without a database, and re-seeding the fixture resets cleanly.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "@/lib/supabase";
import type { CaptureSessionStatus } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const QUEUE_PATH = path.join(DATA_DIR, "pending-submissions.local.json");
const SUBMISSION_REVIEWS_PATH = path.join(DATA_DIR, "submission-reviews.local.json");
export const CAPTURE_REVIEW_OVERLAY_PATH = path.join(
  DATA_DIR,
  "capture-review-overlay.local.json",
);

export type CaptureReviewOverlayEntry = {
  status: Extract<CaptureSessionStatus, "approved" | "rejected">;
  reason: string;
  reviewed_at: string;
};

export type CaptureReviewOverlay = Record<string, CaptureReviewOverlayEntry>;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Local review decisions per capture session. Missing file → none. */
export async function readCaptureReviewOverlay(): Promise<CaptureReviewOverlay> {
  return readJson<CaptureReviewOverlay>(CAPTURE_REVIEW_OVERLAY_PATH, {});
}

export type FinalizeArgs = {
  sessionId: string;
  action: "approve" | "reject";
  reason: string;
};

export type FinalizeResult = { mode: "live" | "local" };

/**
 * Record the verdict on a capture session and close its queue row.
 *
 * Called only AFTER the approved observations have landed, mirroring
 * reviewSubmission's "land the data first" rule: a failure here leaves a session
 * that is still reviewable, which is recoverable, rather than one marked approved
 * whose data never arrived, which is not.
 */
export async function finalizeCaptureReview(
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const status = args.action === "approve" ? "approved" : "rejected";
  const reason = args.reason.trim();
  const reviewedAt = new Date().toISOString();

  const client = getSupabaseClient();
  const secret = process.env.ADMIN_RPC_SECRET;
  if (client && secret) {
    const { error } = await client.rpc("capture_close_review", {
      p_session_id: args.sessionId,
      p_action: args.action,
      p_reason: reason,
      p_secret: secret,
    });
    // Deliberately NOT falling back to the local overlay on error. In a
    // Supabase deployment a local write lands in files the live queue never
    // reads: the admin would be told the walk was closed while it sat pending
    // forever. Better to fail loudly and let them try again.
    if (error) throw new Error(`capture_close_review: ${error.message}`);
    return { mode: "live" };
  }

  const overlay = await readCaptureReviewOverlay();
  overlay[args.sessionId] = { status, reason, reviewed_at: reviewedAt };
  await writeJson(CAPTURE_REVIEW_OVERLAY_PATH, overlay);

  // Close the queue row too, through the same overlay lib/submissions.ts reads,
  // so the item leaves the pending queue exactly as a manual submission does.
  const queue = await readJson<
    { id?: unknown; type?: unknown; payload?: unknown }[]
  >(QUEUE_PATH, []);
  const row = Array.isArray(queue)
    ? queue.find(
        (r) =>
          r?.type === "cv_capture" &&
          (r?.payload as { session_id?: unknown } | null)?.session_id ===
            args.sessionId,
      )
    : undefined;
  if (row && typeof row.id === "string") {
    const reviews = await readJson<
      Record<string, { status: string; reason: string; reviewed_at: string }>
    >(SUBMISSION_REVIEWS_PATH, {});
    reviews[row.id] = { status, reason, reviewed_at: reviewedAt };
    await writeJson(SUBMISSION_REVIEWS_PATH, reviews);
  }

  return { mode: "local" };
}
