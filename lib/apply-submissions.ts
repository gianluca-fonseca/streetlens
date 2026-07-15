/**
 * The single application pipeline (advisor ruling 3).
 *
 * ONE code path takes an approved contribution — or a bulk-import feature — and
 * lands it in the dataset as COMMUNITY data. Honesty is the spine:
 *   - an approved `add_segment`   → a community segment (no rubric scores),
 *   - an approved `update_segment`→ a community report on the target segment,
 *   - a bulk-import feature       → a community/import segment.
 * Nothing here fabricates a score or mutates an audited segment.
 *
 * Env-gated exactly like lib/segments.ts and lib/submissions-sink.ts:
 *   - DB mode  (Supabase configured + ADMIN_RPC_SECRET): the SECURITY DEFINER
 *     RPCs from migration 0012 (`admin_apply_submission`, `admin_import_segments`).
 *   - Local mode (the reality today): append to gitignored
 *     `data/community-segments.local.json` + `data/community-reports.local.json`,
 *     which lib/segments.ts merges into its read path at runtime.
 *
 * Applies are IDEMPOTENT: ids derive from the submission id (or the feature id),
 * and writers upsert by id, so re-approving or re-importing never duplicates.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "./supabase";
import type {
  AddSegmentPayload,
  ImportFeature,
  UpdateSegmentPayload,
} from "./schemas";
import type { CommunityReport, CommunitySegment } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const COMMUNITY_SEGMENTS_PATH = path.join(
  DATA_DIR,
  "community-segments.local.json",
);
const COMMUNITY_REPORTS_PATH = path.join(
  DATA_DIR,
  "community-reports.local.json",
);

/** Community contributions have no field-surveyed district; the pilot is Escazú. */
const COMMUNITY_DISTRICT = "Escazú";

/* ------------------------------------------------------------------ *
 * Local file store (upsert-by-id)
 * ------------------------------------------------------------------ */

async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** All applied community segments (local store). Missing file → empty. */
export async function readCommunitySegments(): Promise<CommunitySegment[]> {
  return readJsonArray<CommunitySegment>(COMMUNITY_SEGMENTS_PATH);
}

/** All applied community reports (local store). Missing file → empty. */
export async function readCommunityReports(): Promise<CommunityReport[]> {
  return readJsonArray<CommunityReport>(COMMUNITY_REPORTS_PATH);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Upsert rows into a local store by `id`, preserving order (new ids appended). */
function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()];
}

async function appendCommunitySegments(
  rows: CommunitySegment[],
): Promise<void> {
  if (rows.length === 0) return;
  const merged = upsertById(await readCommunitySegments(), rows);
  await writeJson(COMMUNITY_SEGMENTS_PATH, merged);
}

async function appendCommunityReports(rows: CommunityReport[]): Promise<void> {
  if (rows.length === 0) return;
  const merged = upsertById(await readCommunityReports(), rows);
  await writeJson(COMMUNITY_REPORTS_PATH, merged);
}

/* ------------------------------------------------------------------ *
 * Builders (pure) — an approved submission → a community record
 * ------------------------------------------------------------------ */

/** Input to the apply pipeline: an approved, already-validated submission. */
export type ApplyInput = { id: string; created_at?: string } & (
  | { type: "add_segment"; payload: AddSegmentPayload }
  | { type: "update_segment"; payload: UpdateSegmentPayload }
);

export type ApplyResult =
  | { mode: "supabase" | "local"; kind: "segment"; id: string }
  | { mode: "supabase" | "local"; kind: "report"; segment_id: string; id: string };

/** Readable one-line summary of an update_segment proposal for the report note. */
function describeUpdate(payload: UpdateSegmentPayload): string {
  const parts: string[] = [];
  if (payload.patch.name) parts.push(`name → "${payload.patch.name}"`);
  if (payload.patch.highway) parts.push(`highway → ${payload.patch.highway}`);
  const proposal = parts.length ? `Proposed ${parts.join(", ")}. ` : "";
  return `${proposal}${payload.reason}`.trim();
}

/** Build the community segment a `add_segment` approval becomes (no scores). */
export function buildCommunitySegment(
  input: Extract<ApplyInput, { type: "add_segment" }>,
): CommunitySegment {
  const createdAt = input.created_at ?? new Date().toISOString();
  const id = `com-${input.id}`;
  const note = input.payload.note?.trim();
  return {
    id,
    name: input.payload.name,
    highway: input.payload.highway,
    district: COMMUNITY_DISTRICT,
    source: "community",
    verified: false,
    auditor: null,
    submission_id: input.id,
    coordinates: input.payload.coordinates,
    community_report: note
      ? {
          id: `rep-${input.id}`,
          segment_id: id,
          note,
          submission_id: input.id,
          created_at: createdAt,
        }
      : null,
    created_at: createdAt,
  };
}

/** Build the community report a `update_segment` approval becomes (never a score). */
export function buildCommunityReport(
  input: Extract<ApplyInput, { type: "update_segment" }>,
): CommunityReport {
  return {
    id: `rep-${input.id}`,
    segment_id: input.payload.segment_id,
    note: describeUpdate(input.payload),
    submission_id: input.id,
    created_at: input.created_at ?? new Date().toISOString(),
  };
}

/** Build the community segment a bulk-import feature becomes. */
export function buildImportSegment(
  feature: ImportFeature,
  opts: { verified: boolean; auditor: string | null; createdAt?: string },
  index: number,
): CommunitySegment {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const id = feature.id ? `imp-${feature.id}` : `imp-${createdAt}-${index}`;
  return {
    id,
    name: feature.name,
    highway: feature.highway,
    district: COMMUNITY_DISTRICT,
    source: "import",
    verified: opts.verified,
    auditor: opts.verified ? opts.auditor : null,
    submission_id: null,
    coordinates: feature.coordinates,
    community_report: null,
    created_at: createdAt,
  };
}

/* ------------------------------------------------------------------ *
 * Apply (DB-first, local fallback)
 * ------------------------------------------------------------------ */

function dbSecret(): string | null {
  const client = getSupabaseClient();
  const secret = process.env.ADMIN_RPC_SECRET;
  return client && secret ? secret : null;
}

/**
 * Apply one approved submission. Tries the DB RPC when configured; on any
 * absence or error, applies to the local community store so the flow works with
 * no database. Returns what was created.
 */
export async function applyApprovedSubmission(
  input: ApplyInput,
): Promise<ApplyResult> {
  // DB mode: the RPC owns the insert into community_segments/community_reports.
  const secret = dbSecret();
  if (secret) {
    const client = getSupabaseClient();
    try {
      const { error } = await client!.rpc("admin_apply_submission", {
        p_submission_id: input.id,
        p_secret: secret,
      });
      if (!error) {
        return input.type === "add_segment"
          ? { mode: "supabase", kind: "segment", id: `com-${input.id}` }
          : {
              mode: "supabase",
              kind: "report",
              segment_id: input.payload.segment_id,
              id: `rep-${input.id}`,
            };
      }
      // fall through to local on RPC failure
    } catch {
      // fall through
    }
  }

  // Local mode.
  if (input.type === "add_segment") {
    const segment = buildCommunitySegment(input);
    await appendCommunitySegments([segment]);
    return { mode: "local", kind: "segment", id: segment.id };
  }
  const report = buildCommunityReport(input);
  await appendCommunityReports([report]);
  return {
    mode: "local",
    kind: "report",
    segment_id: report.segment_id,
    id: report.id,
  };
}

export type ImportApplyResult = {
  mode: "supabase" | "local";
  imported: number;
  ids: string[];
};

/**
 * Apply a batch of validated bulk-import features through the same pipeline.
 * Verified imports carry the auditor name; unverified ones stay pending like a
 * community add. DB-first, local fallback.
 */
export async function applyImportFeatures(
  features: ImportFeature[],
  opts: { verified: boolean; auditor: string | null; createdAt?: string },
): Promise<ImportApplyResult> {
  const createdAt = opts.createdAt ?? new Date().toISOString();
  const segments = features.map((f, i) =>
    buildImportSegment(f, { ...opts, createdAt }, i),
  );

  const secret = dbSecret();
  if (secret) {
    const client = getSupabaseClient();
    try {
      const { error } = await client!.rpc("admin_import_segments", {
        p_secret: secret,
        p_features: segments,
        p_verified: opts.verified,
        p_auditor: opts.verified ? opts.auditor : null,
      });
      if (!error) {
        return {
          mode: "supabase",
          imported: segments.length,
          ids: segments.map((s) => s.id),
        };
      }
      // fall through to local
    } catch {
      // fall through
    }
  }

  await appendCommunitySegments(segments);
  return { mode: "local", imported: segments.length, ids: segments.map((s) => s.id) };
}
