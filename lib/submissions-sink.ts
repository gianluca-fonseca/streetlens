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
