/**
 * Where a validated submission lands.
 *
 * Env-gated, mirroring the data layer's philosophy (see lib/segments.ts): when
 * Supabase is configured we insert a `pending` row (RLS in 0006 lets anon
 * insert only pending proposals); otherwise we append to a gitignored local
 * queue file so the whole flow works TONIGHT with no database. The row shape
 * matches `SubmissionRow` in lib/types.ts and the `submissions` migration.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "./supabase";
import type { SubmissionStatus, SubmissionType } from "./types";

/** The columns an anonymous contributor may write (see 0005/0006). */
export type SubmissionInsert = {
  type: SubmissionType;
  payload: unknown;
  status: SubmissionStatus;
  source_ip_hash: string | null;
  honeypot_tripped: boolean;
};

export type SinkResult = { sink: "supabase" | "local"; id: string };

const LOCAL_QUEUE_PATH = path.join(
  process.cwd(),
  "data",
  "pending-submissions.local.json",
);

type LocalRecord = SubmissionInsert & { id: string; created_at: string };

async function readLocalQueue(): Promise<LocalRecord[]> {
  try {
    const raw = await fs.readFile(LOCAL_QUEUE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalRecord[]) : [];
  } catch {
    // Missing or unreadable file → start a fresh queue.
    return [];
  }
}

async function appendLocal(record: SubmissionInsert): Promise<SinkResult> {
  const queue = await readLocalQueue();
  const row: LocalRecord = {
    id: (globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`),
    created_at: new Date().toISOString(),
    ...record,
  };
  queue.push(row);
  await fs.mkdir(path.dirname(LOCAL_QUEUE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_QUEUE_PATH, JSON.stringify(queue, null, 2), "utf8");
  return { sink: "local", id: row.id };
}

/**
 * Persist a submission. Tries Supabase when configured; on any absence or
 * error falls back to the local queue so a contribution is never silently lost.
 */
export async function persistSubmission(
  record: SubmissionInsert,
): Promise<SinkResult> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from("submissions")
        .insert({
          type: record.type,
          payload: record.payload,
          status: record.status,
          source_ip_hash: record.source_ip_hash,
          honeypot_tripped: record.honeypot_tripped,
        })
        .select("id")
        .single();
      if (!error && data) {
        return { sink: "supabase", id: (data as { id: string }).id };
      }
    } catch {
      // fall through to local queue
    }
  }
  return appendLocal(record);
}

/** Test/inspection helper: current count of pending (non-honeypot) records in the local queue. */
export async function localPendingCount(): Promise<number> {
  const queue = await readLocalQueue();
  return queue.filter((r) => r.status === "pending" && !r.honeypot_tripped)
    .length;
}

/**
 * Raised when a capture session could not be filed into the review queue.
 *
 * Deliberately loud. See `emitCaptureSubmission`.
 */
export class CaptureEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureEmitError";
  }
}

/**
 * File a finished capture session into the review queue as a `cv_capture` row
 * (u30). Called by the pump at rollup completion; never by a contributor.
 *
 * IDEMPOTENT, because it has to be. The caller emits BEFORE flipping the session
 * to review_ready, since that write is the drain latch — the drain query only
 * selects `extracting`, so a session that reaches review_ready is never revisited
 * and a row lost after that point is lost permanently. Emitting first means a
 * crash in between simply re-emits on the next pump, which is only safe if a
 * second emit is a no-op.
 *
 * Live mode dedupes inside the RPC rather than here. It has no choice: 0006 gives
 * anon INSERT on submissions and deliberately NO SELECT policy (the queue holds ip
 * hashes and reviewer notes), so a check-then-insert from application code cannot
 * see what it is checking for.
 *
 * On a live failure this THROWS rather than falling back to the local queue. A
 * local write in a Supabase-configured deployment lands in a file the live queue
 * never reads: the session would go review_ready with no queue row, and no human
 * would ever see the walk. Throwing leaves the session `extracting`, which the
 * next pump retries.
 */
export async function emitCaptureSubmission(sessionId: string): Promise<void> {
  const client = getSupabaseClient();
  const secret = process.env.ADMIN_RPC_SECRET;

  if (client && secret) {
    try {
      const { error } = await client.rpc("capture_emit_submission", {
        p_session_id: sessionId,
        p_secret: secret,
      });
      if (error) throw new CaptureEmitError(error.message);
      return;
    } catch (err) {
      if (err instanceof CaptureEmitError) throw err;
      throw new CaptureEmitError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Local mode: the queue file is readable here, so dedupe directly.
  const queue = await readLocalQueue();
  const already = queue.some(
    (r) =>
      r.type === "cv_capture" &&
      (r.payload as { session_id?: unknown } | null)?.session_id === sessionId,
  );
  if (already) return;

  await appendLocal({
    type: "cv_capture",
    payload: { session_id: sessionId },
    status: "pending",
    source_ip_hash: null,
    honeypot_tripped: false,
  });
}
