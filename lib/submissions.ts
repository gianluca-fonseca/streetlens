/**
 * Submissions data-access for the admin verification queue.
 *
 * Reading order (first hit wins):
 *   1. Supabase — the `admin_list_submissions` SECURITY DEFINER RPC (adjudicated
 *      in advisor rev 2; authenticated by ADMIN_RPC_SECRET). The DB does not
 *      exist yet, so this is best-effort and falls through on any error.
 *   2. `data/pending-submissions.local.json` — the runtime queue written by the
 *      contribution unit (u3), gitignored.
 *   3. `data/pending-submissions.sample.json` — committed, clearly-labelled
 *      SAMPLE fixtures so the queue renders out of the box. When this source is
 *      active the UI must show the demo treatment (honesty rule, rev 2 ruling 3).
 *
 * In the local/sample paths, review state is kept as an immutable base plus an
 * overlay (`data/submission-reviews.local.json`); approvals are staged to
 * `data/approved-submissions.local.json`. Live application of approved data to
 * segments is an explicit post-DB step — admin code NEVER writes to segments.
 *
 * Shape note (u3 coordination): the local queue file is an array of records
 * shaped like `SubmissionRow` (`lib/types.ts`), themselves carrying payloads
 * that satisfy the `lib/schemas.ts` zod schemas. If u3 lands a different local
 * shape, reconcile on this file only.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "./supabase";
import {
  addSegmentPayloadSchema,
  updateSegmentPayloadSchema,
} from "./schemas";
import type { SubmissionStatus, SubmissionType } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SAMPLE_PATH = path.join(DATA_DIR, "pending-submissions.sample.json");
const LOCAL_PATH = path.join(DATA_DIR, "pending-submissions.local.json");
const REVIEWS_PATH = path.join(DATA_DIR, "submission-reviews.local.json");
const APPROVED_PATH = path.join(DATA_DIR, "approved-submissions.local.json");

export type SubmissionSource = "supabase" | "local" | "sample";
export type ReviewAction = "approve" | "reject";

/** A queue item, normalized for the admin UI. */
export type QueueSubmission = {
  id: string;
  type: SubmissionType;
  payload: unknown;
  status: SubmissionStatus;
  created_at: string;
  contact?: string | null;
};

export type SubmissionCounts = {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
};

type RawRecord = {
  id?: unknown;
  type?: unknown;
  payload?: unknown;
  status?: unknown;
  created_at?: unknown;
  contact?: unknown;
};

type ReviewOverlay = Record<
  string,
  { status: SubmissionStatus; reason: string; reviewed_at: string }
>;

/* ------------------------------------------------------------------ *
 * File helpers
 * ------------------------------------------------------------------ */

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function extractRecords(parsed: unknown): RawRecord[] {
  if (Array.isArray(parsed)) return parsed as RawRecord[];
  if (parsed && typeof parsed === "object") {
    const list = (parsed as { submissions?: unknown }).submissions;
    if (Array.isArray(list)) return list as RawRecord[];
  }
  return [];
}

/** Validate + normalize a raw record; returns null if it is malformed. */
function normalizeRecord(raw: RawRecord): QueueSubmission | null {
  if (typeof raw.id !== "string") return null;
  if (raw.type !== "add_segment" && raw.type !== "update_segment") return null;

  const schema =
    raw.type === "add_segment"
      ? addSegmentPayloadSchema
      : updateSegmentPayloadSchema;
  const parsed = schema.safeParse(raw.payload);
  if (!parsed.success) return null;

  const status: SubmissionStatus =
    raw.status === "approved" || raw.status === "rejected"
      ? raw.status
      : "pending";

  return {
    id: raw.id,
    type: raw.type,
    payload: parsed.data,
    status,
    created_at:
      typeof raw.created_at === "string"
        ? raw.created_at
        : new Date(0).toISOString(),
    contact: typeof raw.contact === "string" ? raw.contact : null,
  };
}

/* ------------------------------------------------------------------ *
 * Base list (source resolution)
 * ------------------------------------------------------------------ */

async function liveList(): Promise<QueueSubmission[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const secret = process.env.ADMIN_RPC_SECRET;
  if (!secret) return null;
  try {
    const { data, error } = await client.rpc("admin_list_submissions", {
      p_secret: secret,
      p_status_filter: null,
    });
    if (error || !Array.isArray(data)) return null;
    return (data as RawRecord[])
      .map(normalizeRecord)
      .filter((x): x is QueueSubmission => x !== null);
  } catch {
    return null;
  }
}

async function baseList(): Promise<{
  items: QueueSubmission[];
  source: SubmissionSource;
}> {
  const live = await liveList();
  if (live) return { items: live, source: "supabase" };

  const local = await readJsonFile(LOCAL_PATH);
  if (local !== null) {
    const items = extractRecords(local)
      .map(normalizeRecord)
      .filter((x): x is QueueSubmission => x !== null);
    return { items, source: "local" };
  }

  const sample = await readJsonFile(SAMPLE_PATH);
  const items = extractRecords(sample)
    .map(normalizeRecord)
    .filter((x): x is QueueSubmission => x !== null);
  return { items, source: "sample" };
}

async function readOverlay(): Promise<ReviewOverlay> {
  const parsed = await readJsonFile(REVIEWS_PATH);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as ReviewOverlay;
  }
  return {};
}

/* ------------------------------------------------------------------ *
 * Public read API
 * ------------------------------------------------------------------ */

/** All submissions with effective status (overlay applied for local/sample). */
export async function getSubmissions(): Promise<{
  items: QueueSubmission[];
  source: SubmissionSource;
}> {
  const { items, source } = await baseList();
  if (source === "supabase") return { items, source };

  const overlay = await readOverlay();
  const merged = items.map((item) => {
    const review = overlay[item.id];
    return review ? { ...item, status: review.status } : item;
  });
  return { items: merged, source };
}

/** Pending submissions only (plus the active source, for the demo treatment). */
export async function getPendingSubmissions(): Promise<{
  items: QueueSubmission[];
  source: SubmissionSource;
}> {
  const { items, source } = await getSubmissions();
  return { items: items.filter((i) => i.status === "pending"), source };
}

/** Aggregate submission counts by status. */
export async function getSubmissionCounts(): Promise<SubmissionCounts> {
  const { items } = await getSubmissions();
  const counts: SubmissionCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: items.length,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/* ------------------------------------------------------------------ *
 * Review (approve / reject)
 * ------------------------------------------------------------------ */

export type ReviewResult =
  | { ok: true; status: SubmissionStatus; source: SubmissionSource }
  | { ok: false; error: "not_found" | "invalid_reason" | "invalid_action" };

/**
 * Approve or reject a pending submission.
 * - Supabase present: delegate to the `admin_review_submission` RPC.
 * - Otherwise: record the decision in the local overlay and, for approvals,
 *   stage the item to `approved-submissions.local.json`.
 */
export async function reviewSubmission(
  id: string,
  action: string,
  reason: string,
): Promise<ReviewResult> {
  if (action !== "approve" && action !== "reject") {
    return { ok: false, error: "invalid_action" };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ok: false, error: "invalid_reason" };
  }
  const newStatus: SubmissionStatus =
    action === "approve" ? "approved" : "rejected";
  const trimmedReason = reason.trim();

  // Live path: RPC handles everything (auth via secret, DB write).
  const client = getSupabaseClient();
  if (client && process.env.ADMIN_RPC_SECRET) {
    try {
      const { error } = await client.rpc("admin_review_submission", {
        p_submission_id: id,
        p_action: action,
        p_reason: trimmedReason,
        p_secret: process.env.ADMIN_RPC_SECRET,
      });
      if (!error) {
        return { ok: true, status: newStatus, source: "supabase" };
      }
      // fall through to local staging on RPC failure
    } catch {
      // fall through
    }
  }

  // Local path: must be a currently-pending item.
  const { items, source } = await getSubmissions();
  const target = items.find((i) => i.id === id);
  if (!target || target.status !== "pending") {
    return { ok: false, error: "not_found" };
  }

  const reviewedAt = new Date().toISOString();
  const overlay = await readOverlay();
  overlay[id] = { status: newStatus, reason: trimmedReason, reviewed_at: reviewedAt };
  await fs.writeFile(REVIEWS_PATH, JSON.stringify(overlay, null, 2), "utf8");

  if (action === "approve") {
    const existing = await readJsonFile(APPROVED_PATH);
    const list = Array.isArray(existing) ? existing : [];
    list.push({
      ...target,
      status: newStatus,
      reviewer_note: trimmedReason,
      reviewed_at: reviewedAt,
    });
    await fs.writeFile(APPROVED_PATH, JSON.stringify(list, null, 2), "utf8");
  }

  return { ok: true, status: newStatus, source };
}
