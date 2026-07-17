/**
 * The capture funnel's database surface, as one typed seam.
 *
 * Every capture_* table is RLS-on with zero policies (0013), so there is no
 * table access here at all — only SECURITY DEFINER RPC calls. That is the whole
 * security model: this module cannot read a frame it is not entitled to, no
 * matter what it asks for, because the entitlement is enforced in the database.
 *
 * WHY AN INTERFACE. `CaptureDb` is the one thing the routes, the pump and the
 * rollup talk to, so the node tests drive the real worker logic against an
 * in-memory fake instead of a live Postgres. The alternative — mocking the
 * supabase client's fluent builder — tests the mock, not the code.
 *
 * The privileged calls carry ADMIN_RPC_SECRET (the 0007/0013 pattern); the
 * public ones are authorized by the session uuid capability alone and pass no
 * secret, exactly as a browser would call them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import type {
  CaptureFrameMeta,
  CaptureSessionMode,
  CaptureSessionStatus,
  RubricItemKey,
  CaptureObservationItem,
} from "./types";
import type { TrackPoint } from "./types";

/* ------------------------------------------------------------------ *
 * Row shapes returned by the RPCs (0013 + 0015)
 * ------------------------------------------------------------------ */

export type FrameRow = {
  id: string;
  seq: number;
  t: number;
  storage_path: string;
  segment_id: string | null;
  near_junction: boolean;
};

/** A job claimed by the pump, joined to everything needed to run it. */
export type ClaimedJob = {
  job_id: string;
  frame_id: string;
  attempts: number;
  session_id: string;
  seq: number;
  storage_path: string;
  segment_id: string;
  near_junction: boolean;
};

export type ObservationRow = {
  frame_id: string;
  segment_id: string | null;
  model: string;
  items: Record<RubricItemKey, CaptureObservationItem>;
  usable: boolean;
  confidence: number | null;
  escalated: boolean;
  near_junction: boolean;
  seq: number;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  observations: number;
  escalated: number;
};

/** One frame's match result, as finalize persists it. */
export type FrameAttributionWrite = {
  seq: number;
  segmentId: string | null;
  nearJunction: boolean;
  /** Interpolated capture position. Omitted when the frame could not be placed. */
  lng?: number;
  lat?: number;
};

export type CompleteJobArgs = {
  frameId: string;
  model: string;
  items: Record<RubricItemKey, CaptureObservationItem>;
  usable: boolean;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  escalated: boolean;
  /** The model's per-frame plain-language note (0020). */
  rationale: string;
};

export type RollupWrite = {
  sessionId: string;
  segmentId: string;
  scores: Record<string, number | null>;
  itemMedians: Record<string, unknown>;
  coverage: number | null;
  confidence: number | null;
};

export type SessionStatusPayload = {
  status: CaptureSessionStatus;
  frameCount: number;
  jobs: { pending: number; done: number; failed: number };
  rollups?: {
    segmentId: string;
    coverage: number;
    confidence: number;
    scores: Record<string, number>;
  }[];
};

/* ------------------------------------------------------------------ *
 * The seam
 * ------------------------------------------------------------------ */

export interface CaptureDb {
  /* Public, uuid-capability scoped (0013) */
  createSession(args: {
    mode: CaptureSessionMode;
    ipHash: string | null;
    contact?: string;
  }): Promise<string>;
  registerFrames(sessionId: string, frames: CaptureFrameMeta[]): Promise<number[]>;
  finalizeSession(
    sessionId: string,
    track: TrackPoint[],
    clockOffsetMs: number,
  ): Promise<string>;
  sessionStatus(sessionId: string): Promise<SessionStatusPayload>;

  /* Privileged worker surface (0015 + 0013's admin set) */
  listFrames(sessionId: string): Promise<FrameRow[]>;
  attributeFrames(sessionId: string, attributions: FrameAttributionWrite[]): Promise<number>;
  failUnattributedJobs(sessionId: string): Promise<number>;
  claimJobs(limit: number): Promise<ClaimedJob[]>;
  /**
   * Claim jobs belonging to ONE session (u30). Backs the contributor's
   * pump-on-poll, which must never be able to drive the whole queue.
   */
  claimJobsForSession(sessionId: string, limit: number): Promise<ClaimedJob[]>;
  completeJob(args: CompleteJobArgs): Promise<void>;
  failJob(frameId: string, status: "failed" | "failed_overbudget" | "pending", error: string): Promise<void>;
  sessionTokenUsage(sessionId: string): Promise<TokenUsage>;
  listObservations(sessionId: string): Promise<ObservationRow[]>;
  drainedSessions(limit: number): Promise<string[]>;
  pendingJobCount(): Promise<number>;
  upsertRollup(rollup: RollupWrite): Promise<void>;
  setSessionStatus(sessionId: string, status: CaptureSessionStatus): Promise<void>;
}

/**
 * Raised when a database call fails. Carries the RPC name so a failure in the
 * pump's inner loop is traceable to the call that produced it rather than
 * surfacing as a bare postgres string.
 */
export class CaptureDbError extends Error {
  constructor(
    readonly rpc: string,
    message: string,
  ) {
    super(`${rpc}: ${message}`);
    this.name = "CaptureDbError";
  }
}

/** Thrown when capture_create_session hits the database-side per-origin ceiling. */
export class RateLimitedError extends Error {
  constructor() {
    super("rate_limited");
    this.name = "RateLimitedError";
  }
}

function adminSecret(): string {
  const secret = process.env.ADMIN_RPC_SECRET;
  if (!secret) {
    throw new Error("ADMIN_RPC_SECRET is not configured");
  }
  return secret;
}

/**
 * The live implementation, over the anon Supabase client.
 *
 * The anon key is correct here and not a shortfall: this deployment has no
 * service-role key at all (0013's header says so), and every function it calls
 * gates itself internally. The role is never what is trusted.
 */
export function createCaptureDb(client: SupabaseClient): CaptureDb {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (/rate_limited/i.test(error.message)) throw new RateLimitedError();
      throw new CaptureDbError(name, error.message);
    }
    return data as T;
  }

  return {
    async createSession({ mode, ipHash, contact }) {
      return rpc<string>("capture_create_session", {
        p_mode: mode,
        p_ip_hash: ipHash,
        p_contact: contact ?? null,
      });
    },

    async registerFrames(sessionId, frames) {
      // The RPC derives storage_path from seq itself and ignores anything the
      // client sent, so only the fields it reads are forwarded.
      const payload = frames.map((f) => ({
        seq: f.seq,
        t: f.t,
        width: f.width,
        height: f.height,
        bytes: f.bytes,
        blurScore: f.blurScore ?? null,
      }));
      return rpc<number[]>("capture_register_frames", {
        p_session_id: sessionId,
        p_frames: payload,
      });
    },

    async finalizeSession(sessionId, track, clockOffsetMs) {
      return rpc<string>("capture_finalize_session", {
        p_session_id: sessionId,
        p_track: track.map((p) => ({ lng: p.lng, lat: p.lat })),
        p_clock_offset_ms: clockOffsetMs,
      });
    },

    async sessionStatus(sessionId) {
      return rpc<SessionStatusPayload>("capture_session_status", {
        p_session_id: sessionId,
      });
    },

    async listFrames(sessionId) {
      return (
        (await rpc<FrameRow[]>("capture_list_frames", {
          p_session_id: sessionId,
          p_secret: adminSecret(),
        })) ?? []
      );
    },

    async attributeFrames(sessionId, attributions) {
      return rpc<number>("capture_attribute_frames", {
        p_session_id: sessionId,
        p_attributions: attributions,
        p_secret: adminSecret(),
      });
    },

    async failUnattributedJobs(sessionId) {
      return rpc<number>("capture_fail_unattributed_jobs", {
        p_session_id: sessionId,
        p_secret: adminSecret(),
      });
    },

    async claimJobs(limit) {
      return (
        (await rpc<ClaimedJob[]>("capture_claim_jobs_with_frames", {
          p_limit: limit,
          p_secret: adminSecret(),
        })) ?? []
      );
    },

    async claimJobsForSession(sessionId, limit) {
      return (
        (await rpc<ClaimedJob[]>("capture_claim_jobs_for_session", {
          p_session_id: sessionId,
          p_limit: limit,
          p_secret: adminSecret(),
        })) ?? []
      );
    },

    async completeJob(args) {
      await rpc<void>("capture_complete_job", {
        p_frame_id: args.frameId,
        p_model: args.model,
        p_items: args.items,
        p_usable: args.usable,
        p_confidence: args.confidence,
        p_input_tokens: args.inputTokens,
        p_output_tokens: args.outputTokens,
        p_escalated: args.escalated,
        p_rationale: args.rationale,
        p_secret: adminSecret(),
      });
    },

    async failJob(frameId, status, error) {
      await rpc<void>("capture_fail_job", {
        p_frame_id: frameId,
        p_status: status,
        p_error: error,
        p_secret: adminSecret(),
      });
    },

    async sessionTokenUsage(sessionId) {
      return rpc<TokenUsage>("capture_session_token_usage", {
        p_session_id: sessionId,
        p_secret: adminSecret(),
      });
    },

    async listObservations(sessionId) {
      return (
        (await rpc<ObservationRow[]>("capture_list_observations", {
          p_session_id: sessionId,
          p_secret: adminSecret(),
        })) ?? []
      );
    },

    async drainedSessions(limit) {
      const rows = await rpc<{ capture_drained_sessions: string }[] | string[]>(
        "capture_drained_sessions",
        { p_limit: limit, p_secret: adminSecret() },
      );
      if (!Array.isArray(rows)) return [];
      // A `returns setof uuid` comes back as bare strings via PostgREST; the
      // object form is tolerated so a fake or a future column rename cannot
      // silently yield zero sessions and stall every rollup.
      return rows.map((r) =>
        typeof r === "string" ? r : (r as { capture_drained_sessions: string }).capture_drained_sessions,
      );
    },

    async pendingJobCount() {
      return (await rpc<number>("capture_pending_job_count", { p_secret: adminSecret() })) ?? 0;
    },

    async upsertRollup(rollup) {
      await rpc<void>("capture_upsert_rollup", {
        p_session_id: rollup.sessionId,
        p_segment_id: rollup.segmentId,
        p_scores: rollup.scores,
        p_item_medians: rollup.itemMedians,
        p_coverage: rollup.coverage,
        p_confidence: rollup.confidence,
        p_secret: adminSecret(),
      });
    },

    async setSessionStatus(sessionId, status) {
      await rpc<void>("capture_set_session_status", {
        p_session_id: sessionId,
        p_status: status,
        p_secret: adminSecret(),
      });
    },
  };
}

/**
 * The configured CaptureDb, or null when Supabase is not set up.
 *
 * Null is a real answer, not an error: `lib/supabase.ts` hands back null when
 * the env is absent and every caller in this repo falls back rather than
 * throwing. The capture routes answer 503 on null, because unlike the map there
 * is no static fallback for "record my session".
 */
export function getCaptureDb(): CaptureDb | null {
  const client = getSupabaseClient();
  if (!client) return null;
  return createCaptureDb(client);
}
