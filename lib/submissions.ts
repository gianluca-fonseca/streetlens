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
import type { z } from "zod";
import { getSupabaseClient } from "./supabase";
import {
  addSegmentPayloadSchema,
  cvCapturePayloadSchema,
  updateSegmentPayloadSchema,
  type AddSegmentPayload,
  type UpdateSegmentPayload,
} from "./schemas";
import { applyApprovedSubmission, type ApplyInput } from "./apply-submissions";
import { isSubmissionType, type SubmissionStatus, type SubmissionType } from "./types";

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

/**
 * A submission reconciled to ONE effective status — the single source of truth
 * (advisor ruling 5). Every record with a usable id+type is kept, INCLUDING
 * records whose payload fails validation: a rejected submission is often
 * rejected *because* its payload was malformed, and the Overview counters must
 * not silently drop it. `payloadValid` gates rendering, never counting.
 */
type ReconciledSubmission = {
  id: string;
  type: SubmissionType;
  /** Effective status: the review overlay wins, else the record's base status. */
  status: SubmissionStatus;
  created_at: string;
  contact: string | null;
  /** Parsed payload when valid; the raw payload otherwise. */
  payload: unknown;
  payloadValid: boolean;
};

/* ------------------------------------------------------------------ *
 * Source resolution (raw) + reconciliation
 * ------------------------------------------------------------------ */

async function readOverlay(): Promise<ReviewOverlay> {
  const parsed = await readJsonFile(REVIEWS_PATH);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as ReviewOverlay;
  }
  return {};
}

/** Raw records from the live RPC, or null when the DB is unavailable. */
async function liveRawList(): Promise<RawRecord[] | null> {
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
    return data as RawRecord[];
  } catch {
    return null;
  }
}

/** Resolve the active source and return its raw (unfiltered) records. */
async function baseRawList(): Promise<{
  raw: RawRecord[];
  source: SubmissionSource;
}> {
  const live = await liveRawList();
  if (live) return { raw: live, source: "supabase" };

  const local = await readJsonFile(LOCAL_PATH);
  if (local !== null) return { raw: extractRecords(local), source: "local" };

  const sample = await readJsonFile(SAMPLE_PATH);
  return { raw: extractRecords(sample), source: "sample" };
}

/**
 * Payload schema per submission type, or `null` where no payload is
 * renderable yet.
 *
 * `cv_capture` gets its schema here (u30): there is now something to show, so the
 * row becomes renderable and reaches the queue. `unknown` stays null — it is a bot
 * artifact, it is COUNTED (see reconcileRecord) but never rendered, and it never
 * gets a card.
 */
const PAYLOAD_SCHEMAS: Record<SubmissionType, z.ZodType | null> = {
  add_segment: addSegmentPayloadSchema,
  update_segment: updateSegmentPayloadSchema,
  cv_capture: cvCapturePayloadSchema,
  unknown: null,
};

/** Reconcile one raw record to a single effective status. */
function reconcileRecord(
  raw: RawRecord,
  overlay: ReviewOverlay,
): ReconciledSubmission | null {
  if (typeof raw.id !== "string") return null;
  // Every KNOWN type is kept, not just the two renderable ones (u25). The
  // honeypot path now files a bot's unrecognized type as `unknown` rather than
  // mislabelling it `add_segment`; hard-filtering to the renderable types here
  // would make those rejected rows vanish from the counters, which is exactly
  // the count-everything doctrine below being violated by a fix elsewhere.
  if (!isSubmissionType(raw.type)) return null;

  const baseStatus: SubmissionStatus =
    raw.status === "approved" || raw.status === "rejected"
      ? raw.status
      : "pending";
  const review = overlay[raw.id];
  const status = review ? review.status : baseStatus;

  const schema = PAYLOAD_SCHEMAS[raw.type];
  const parsed = schema?.safeParse(raw.payload);

  return {
    id: raw.id,
    type: raw.type,
    status,
    created_at:
      typeof raw.created_at === "string"
        ? raw.created_at
        : new Date(0).toISOString(),
    contact: typeof raw.contact === "string" ? raw.contact : null,
    payload: parsed?.success ? parsed.data : raw.payload,
    payloadValid: parsed?.success ?? false,
  };
}

/**
 * THE single reconciled source. Overlay is applied for local/sample (the DB is
 * authoritative on the supabase path). Records are kept regardless of payload
 * validity so counts stay honest.
 */
async function getReconciledSubmissions(): Promise<{
  items: ReconciledSubmission[];
  source: SubmissionSource;
}> {
  const { raw, source } = await baseRawList();
  const overlay = source === "supabase" ? {} : await readOverlay();
  const items = raw
    .map((r) => reconcileRecord(r, overlay))
    .filter((x): x is ReconciledSubmission => x !== null);
  return { items, source };
}

/* ------------------------------------------------------------------ *
 * Public read API
 * ------------------------------------------------------------------ */

/** Renderable submissions (valid payload) with effective status, for the queue. */
export async function getSubmissions(): Promise<{
  items: QueueSubmission[];
  source: SubmissionSource;
}> {
  const { items, source } = await getReconciledSubmissions();
  return {
    items: items
      .filter((i) => i.payloadValid)
      .map((i) => ({
        id: i.id,
        type: i.type,
        payload: i.payload,
        status: i.status,
        created_at: i.created_at,
        contact: i.contact,
      })),
    source,
  };
}

/** Pending submissions only (plus the active source, for the demo treatment). */
export async function getPendingSubmissions(): Promise<{
  items: QueueSubmission[];
  source: SubmissionSource;
}> {
  const { items, source } = await getSubmissions();
  return { items: items.filter((i) => i.status === "pending"), source };
}

/**
 * Aggregate submission counts by status, from the single reconciled source
 * (ruling 5). Counts EVERY record — including payload-invalid ones — so a
 * file-status-rejected record that lacks a review entry is never missed. `total`
 * is derived from the tally, so the buckets can never drift from it.
 */
export async function getSubmissionCounts(): Promise<SubmissionCounts> {
  const { items } = await getReconciledSubmissions();
  const counts: SubmissionCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  };
  for (const item of items) {
    counts[item.status] += 1;
    counts.total += 1;
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * Review (approve / reject)
 * ------------------------------------------------------------------ */

export type ReviewResult =
  | { ok: true; status: SubmissionStatus; source: SubmissionSource }
  | {
      ok: false;
      error: "not_found" | "invalid_reason" | "invalid_action" | "wrong_pipeline";
    };

/**
 * A renderable submission → the apply pipeline's typed input, or `null` when
 * the type does not belong in that pipeline.
 *
 * The null case matters (u25): the apply pipeline turns proposals into
 * community segments and reports, and a cv_capture is neither. This used to be
 * a two-branch ternary whose else-branch swept every non-add type into
 * `update_segment` — harmless while exactly two types existed, a silent
 * data-corruption bug the moment a third appeared.
 */
function toApplyInput(target: QueueSubmission): ApplyInput | null {
  if (target.type === "add_segment") {
    return {
      id: target.id,
      created_at: target.created_at,
      type: "add_segment",
      payload: target.payload as AddSegmentPayload,
    };
  }
  if (target.type === "update_segment") {
    return {
      id: target.id,
      created_at: target.created_at,
      type: "update_segment",
      payload: target.payload as UpdateSegmentPayload,
    };
  }
  // cv_capture: unit-capture-review owns what approving a capture does.
  return null;
}

/**
 * Approve or reject a pending submission. Approval routes the contribution
 * through the SINGLE apply pipeline (lib/apply-submissions.ts, ruling 3), so an
 * approved add_segment becomes a community segment and an approved update_segment
 * becomes a community report — the same code path bulk import uses.
 * - Supabase present: `admin_review_submission` RPC, then apply.
 * - Otherwise: record the decision in the local overlay, apply to the community
 *   store, and stage the item to `approved-submissions.local.json`.
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

  // The target (with parsed payload) drives the apply step for both paths.
  const { items, source } = await getSubmissions();
  const target = items.find((i) => i.id === id);

  // A cv_capture does not belong to this pipeline, and until u30 it could not
  // reach here at all (no payload schema => not renderable => never a `target`).
  // Giving it a schema opened this door, so it is closed explicitly rather than
  // by the UI's good manners: toApplyInput returns null for cv_capture, so an
  // approve here would write an "approved" marker and apply NOTHING — the exact
  // silent-no-op the null branch exists to prevent. Capture review is per-segment
  // and lives at /api/admin/capture/review.
  if (target?.type === "cv_capture") {
    return { ok: false, error: "wrong_pipeline" };
  }

  // Live path: RPC handles auth + DB write; then apply lands the community data.
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
        if (action === "approve" && target) {
          const input = toApplyInput(target);
          if (input) await applyApprovedSubmission(input);
        }
        return { ok: true, status: newStatus, source: "supabase" };
      }
      // fall through to local staging on RPC failure
    } catch {
      // fall through
    }
  }

  // Local path: must be a currently-pending item.
  if (!target || target.status !== "pending") {
    return { ok: false, error: "not_found" };
  }

  // Land the data FIRST so a write failure never leaves an "approved" marker
  // without the segment/report actually applied.
  if (action === "approve") {
    const input = toApplyInput(target);
    if (input) await applyApprovedSubmission(input);
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
