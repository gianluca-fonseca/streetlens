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

import { getSupabaseClient } from "./supabase";
import {
  appendCommunityReports,
  appendCommunitySegments,
  appendCvObservations,
  pruneCvObservations,
} from "./community-store";
import type {
  AddSegmentPayload,
  ImportFeature,
  UpdateSegmentPayload,
} from "./schemas";
import type {
  CommunityReport,
  CommunitySegment,
  CvAssessment,
  CvItemMedian,
  CvObservation,
  ScoreLayer,
} from "./types";

/** Community contributions have no field-surveyed district; the pilot is Escazú. */
const COMMUNITY_DISTRICT = "Escazú";

/** Normalize validated [lng, lat] positions to a concrete tuple array. */
function toCoords(
  positions: readonly (readonly number[])[],
): [number, number][] {
  return positions.map((p) => [p[0], p[1]]);
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
    coordinates: toCoords(input.payload.coordinates),
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
    coordinates: toCoords(feature.coordinates),
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

/** Compact description of a caught error (code + message) for a best-effort warning. */
function errorDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: string; message?: string };
    if (e.code || e.message) return `${e.code ?? "ERR"}: ${e.message ?? String(err)}`;
  }
  return String(err);
}

/**
 * Best-effort local mirror of an approved capture session, for LIVE mode only.
 *
 * In live mode the DB (via `admin_apply_capture_session`) is the source of truth
 * and the community store files are only a convenience mirror for a same-box
 * drive. Vercel's serverless filesystem is read-only outside /tmp, so this write
 * throws EROFS/ENOENT there — which must NOT fail an approval whose authoritative
 * write already committed to Postgres. The failure is logged (path and code ride
 * the fs error message) and swallowed. Local mode never calls this: there the
 * files ARE the store and a failure must surface.
 */
async function mirrorCvLocally(
  sessionId: string,
  keepIds: string[],
  rows: CvObservation[],
): Promise<void> {
  try {
    await pruneCvObservations(sessionId, keepIds);
    await appendCvObservations(rows);
  } catch (err) {
    console.warn(
      `[capture apply] local CV mirror skipped for session ${sessionId} (live DB is authoritative): ${errorDetail(err)}`,
    );
  }
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

/* ------------------------------------------------------------------ *
 * Approved capture sessions (u30)
 *
 * The third kind. An approved capture session becomes CvObservation rows — never
 * a segment, never a score on an audited segment. The same honesty spine as
 * above: the camera's opinion enters as its own record, merged at read time,
 * rendered as provisional, counted separately.
 * ------------------------------------------------------------------ */

/** One segment's worth of approved camera evidence, as the review page has it. */
export type CvApplyObservation = {
  segment_id: string;
  scores: Record<ScoreLayer, number | null>;
  item_medians: Record<string, CvItemMedian>;
  coverage: number;
  confidence: number | null;
  frame_refs: string[];
  /** True when a reviewer corrected this segment before approving (u2). */
  human_corrected?: boolean;
  /** Compact audit record of the reviewer's corrections for this segment (u2). */
  overrides?: Record<string, unknown>;
  /** The segment synthesis approved alongside the numbers (u2). Null when none. */
  assessment?: CvAssessment | null;
};

/** Input to the capture apply path: a session and the segments an admin approved. */
export type CvApplyInput = {
  session_id: string;
  /** The cv_capture submission that carried it through review; null if none. */
  submission_id: string | null;
  /** When the walk happened, not when it was approved. */
  captured_on: string;
  /**
   * The contributor's contact from the capture session, or null when anonymous.
   * The DB path re-sources this server-side in the apply RPC (authoritative); this
   * carries it for the local mirror, which has no session table to read from.
   */
  contact?: string | null;
  observations: CvApplyObservation[];
  createdAt?: string;
};

export type CvApplyResult = {
  mode: "supabase" | "local";
  kind: "cv_observation";
  session_id: string;
  ids: string[];
};

/** Build the CvObservation rows an approval becomes. Pure; ids are derived. */
export function buildCvObservations(input: CvApplyInput): CvObservation[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return input.observations.map((o) => ({
    id: `cv-${input.session_id}-${o.segment_id}`,
    segment_id: o.segment_id,
    session_id: input.session_id,
    scores: o.scores,
    item_medians: o.item_medians,
    confidence: o.confidence,
    coverage: o.coverage,
    frame_refs: o.frame_refs,
    captured_on: input.captured_on,
    source: "cv",
    submission_id: input.submission_id,
    created_at: createdAt,
    human_corrected: o.human_corrected ?? false,
    overrides: o.overrides ?? {},
    assessment: o.assessment ?? null,
    contact: input.contact ?? null,
  }));
}

/**
 * Apply an approved capture session.
 *
 * Deliberately NOT routed through `admin_apply_submission`. That RPC is
 * per-submission and ends in `raise exception 'unsupported submission type'`
 * (0012:144), which the catch below would swallow into a local write — an
 * approval that reports success while the live DB never heard about it. Capture
 * approval is per-segment anyway and gets its own definer RPC (0017).
 *
 * `prune` before `append` because approval is re-reviewable: an admin who unticks
 * a segment and re-approves must see it leave the map, which an upsert alone
 * would never do.
 *
 * Note the local store is not a fallback in the degraded sense — lib/segments.ts
 * reads community data from these files unconditionally, so this IS the path the
 * map sees today. The RPC keeps the live DB in step for when it becomes the
 * read path too.
 */
export async function applyApprovedCaptureSession(
  input: CvApplyInput,
): Promise<CvApplyResult> {
  const rows = buildCvObservations(input);
  const ids = rows.map((r) => r.id);

  const secret = dbSecret();
  if (secret) {
    const client = getSupabaseClient();
    try {
      const { error } = await client!.rpc("admin_apply_capture_session", {
        p_secret: secret,
        p_session_id: input.session_id,
        p_submission_id: input.submission_id,
        p_observations: rows,
      });
      if (!error) {
        // The DB write is authoritative; the local mirror is best-effort so a
        // read-only serverless FS never fails an approval that already landed.
        await mirrorCvLocally(input.session_id, ids, rows);
        return { mode: "supabase", kind: "cv_observation", session_id: input.session_id, ids };
      }
      // fall through to local-only on RPC failure (0017 not yet applied)
    } catch {
      // fall through
    }
  }

  // Local mode: these files ARE the store, so a write failure must surface rather
  // than reporting a success the map never saw.
  await pruneCvObservations(input.session_id, ids);
  await appendCvObservations(rows);
  return { mode: "local", kind: "cv_observation", session_id: input.session_id, ids };
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
