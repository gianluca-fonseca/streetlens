/**
 * Persistence for capture review dialogues (migration 0036).
 *
 * Live: secret-gated RPCs. Fixture: data/capture-review-dialogues.local.json
 * so the workbench can be driven without a database.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { getSupabaseClient } from "@/lib/supabase";
import type { DialogueRole } from "@/lib/extraction/guided-context";

export type ReviewDialogueMessage = {
  id: string;
  sessionId: string;
  segmentId: string;
  role: DialogueRole;
  content: string;
  recompute: boolean;
  createdAt: string;
};

const FIXTURE_PATH = path.join(getDataDir(), "capture-review-dialogues.local.json");

function adminSecret(): string {
  const s = process.env.ADMIN_RPC_SECRET;
  if (!s) throw new Error("ADMIN_RPC_SECRET is not configured");
  return s;
}

async function readFixture(): Promise<ReviewDialogueMessage[]> {
  try {
    const raw = await fs.readFile(FIXTURE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ReviewDialogueMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFixture(rows: ReviewDialogueMessage[]): Promise<void> {
  await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await fs.writeFile(FIXTURE_PATH, JSON.stringify(rows, null, 2), "utf8");
}

export type AppendDialogueArgs = {
  sessionId: string;
  segmentId: string;
  role: DialogueRole;
  content: string;
  recompute?: boolean;
};

/** Append one message; returns the stored row. */
export async function appendReviewDialogue(
  args: AppendDialogueArgs,
): Promise<ReviewDialogueMessage> {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client.rpc("capture_append_review_dialogue", {
      p_session_id: args.sessionId,
      p_segment_id: args.segmentId,
      p_role: args.role,
      p_content: args.content,
      p_recompute: args.recompute ?? false,
      p_secret: adminSecret(),
    });
    if (error) throw new Error(`append_dialogue: ${error.message}`);
    const row = data as ReviewDialogueMessage;
    return {
      id: row.id,
      sessionId: row.sessionId ?? args.sessionId,
      segmentId: row.segmentId ?? args.segmentId,
      role: row.role ?? args.role,
      content: row.content ?? args.content,
      recompute: row.recompute ?? Boolean(args.recompute),
      createdAt: row.createdAt ?? new Date().toISOString(),
    };
  }

  const rows = await readFixture();
  const msg: ReviewDialogueMessage = {
    id: crypto.randomUUID(),
    sessionId: args.sessionId,
    segmentId: args.segmentId,
    role: args.role,
    content: args.content,
    recompute: args.recompute ?? false,
    createdAt: new Date().toISOString(),
  };
  rows.push(msg);
  await writeFixture(rows);
  return msg;
}

/** List messages for a session (optionally one segment), oldest first. */
export async function listReviewDialogues(
  sessionId: string,
  segmentId?: string | null,
): Promise<ReviewDialogueMessage[]> {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client.rpc("capture_list_review_dialogues", {
      p_session_id: sessionId,
      p_secret: adminSecret(),
      p_segment_id: segmentId ?? null,
    });
    if (error) throw new Error(`list_dialogues: ${error.message}`);
    const rows = (data ?? []) as ReviewDialogueMessage[];
    return Array.isArray(rows) ? rows : [];
  }

  const rows = await readFixture();
  return rows
    .filter((r) => r.sessionId === sessionId && (!segmentId || r.segmentId === segmentId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Group messages by segment id for the workbench initial load. */
export async function listReviewDialoguesBySegment(
  sessionId: string,
): Promise<Record<string, ReviewDialogueMessage[]>> {
  const rows = await listReviewDialogues(sessionId);
  const out: Record<string, ReviewDialogueMessage[]> = {};
  for (const row of rows) {
    const list = out[row.segmentId] ?? (out[row.segmentId] = []);
    list.push(row);
  }
  return out;
}
