/**
 * The extraction pump: claim a bounded batch of frame jobs, extract them, roll
 * up whatever drained.
 *
 * PULL, NOT PUSH. Serverless has no long-lived worker, so something calls this:
 * finalize's after(), the contributor's status polling, or the cron in
 * vercel.json. `remaining` tells the caller whether to call again.
 *
 * SAFE UNDER CONCURRENT INVOCATION BY CONSTRUCTION. Two pumps racing is the
 * normal case, not an edge case — a cron tick and an after() kick will overlap.
 * Safety is not maintained by this file: capture_claim_jobs_with_frames (0015)
 * claims with FOR UPDATE SKIP LOCKED, so two callers take disjoint sets and no
 * frame is ever billed twice. This file must therefore never "helpfully" re-read
 * or re-claim outside that RPC.
 *
 * EVERYTHING HERE SPENDS MONEY. The guards are not decoration: a global kill
 * switch, a per-frame token ceiling, a per-session budget, an escalation cap,
 * and an attempts cap. Each one has been reasoned about where it is enforced.
 */

import pLimit from "p-limit";
import {
  PUMP_BATCH_SIZE,
  PUMP_CONCURRENCY,
  MAX_JOB_ATTEMPTS,
  ROLLUP_BATCH_SIZE,
  ESCALATION_MAX_FRACTION,
  extractionEnabled,
  sessionTokenBudget,
  visionModel,
  escalationModel,
} from "@/lib/extraction/config";
import {
  extractFrame,
  observationConfidence,
  shouldEscalate,
  type ImagePreparer,
} from "@/lib/extraction/extract";
import { downscaleFrame } from "@/lib/extraction/downscale";
import { createOpenAiVisionClient, type VisionClient } from "@/lib/extraction/client";
import type { CaptureDb, ClaimedJob } from "./db";
import { getCaptureDb } from "./db";
import { publicFrameUrl } from "./storage";
import { computeRollups, type RollupObservation } from "./rollup";
import { emitCaptureSubmission } from "@/lib/submissions-sink";
import type { PumpResponse } from "./schemas";

export type PumpDeps = {
  db: CaptureDb;
  vision: VisionClient;
  /** Injectable so tests can assert URL construction without Supabase env. */
  frameUrl?: (storagePath: string) => string;
  /** Injectable so tests drive the real downscale without fetching anything. */
  prepareImage?: ImagePreparer;
  /** Injectable so tests assert the queue emit without writing a real queue file. */
  emitSubmission?: (sessionId: string) => Promise<void>;
  /**
   * Claim only this session's jobs (u30). Set by the contributor's session-scoped
   * pump; unset by the cron and after(), which drain the whole queue.
   */
  sessionId?: string;
  limit?: number;
  concurrency?: number;
};

/** Per-session budget bookkeeping, held for the life of one pump call. */
type SessionState = {
  budget: number;
  inputTokens: number;
  escalationCap: number;
  escalated: number;
  paused: boolean;
};

function emptyResult(remaining: number): PumpResponse {
  return { claimed: 0, done: 0, failed: 0, remaining };
}

/**
 * Run one pump batch.
 *
 * Deps are injected so the node tests drive this exact function — the real
 * claim/extract/complete flow — against an in-memory db and a scripted model.
 */
export async function pumpOnce(deps?: Partial<PumpDeps>): Promise<PumpResponse> {
  const db = deps?.db ?? getCaptureDb();
  if (!db) return emptyResult(0);

  // The kill switch, checked before anything is claimed. Finalize still matches
  // and enqueues while this is off, so flipping it back on drains the backlog
  // rather than asking contributors to walk the street again.
  if (!extractionEnabled()) {
    return emptyResult(await db.pendingJobCount().catch(() => 0));
  }

  const vision = deps?.vision ?? createOpenAiVisionClient();
  const frameUrl = deps?.frameUrl ?? publicFrameUrl;
  const prepareImage = deps?.prepareImage ?? downscaleFrame;
  const emitSubmission = deps?.emitSubmission ?? emitCaptureSubmission;
  const batch = deps?.limit ?? PUMP_BATCH_SIZE;
  const concurrency = deps?.concurrency ?? PUMP_CONCURRENCY;

  // Scoped claim for the contributor's pump-on-poll; the global claim for the
  // cron and after(). A link-holder may only ever move their own walk forward.
  const jobs = deps?.sessionId
    ? await db.claimJobsForSession(deps.sessionId, batch)
    : await db.claimJobs(batch);
  if (jobs.length === 0) {
    await rollupDrainedSessions(db, emitSubmission);
    return emptyResult(await db.pendingJobCount().catch(() => 0));
  }

  const sessions = new Map<string, Promise<SessionState>>();
  const loadSession = (sessionId: string): Promise<SessionState> => {
    // Memoized by session so eight concurrent frames from one session load the
    // budget once, and share one view of it.
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const loading = (async (): Promise<SessionState> => {
      const [status, usage] = await Promise.all([
        db.sessionStatus(sessionId),
        db.sessionTokenUsage(sessionId),
      ]);
      return {
        budget: sessionTokenBudget(status.frameCount),
        inputTokens: usage.inputTokens,
        escalationCap: Math.max(1, Math.floor(status.frameCount * ESCALATION_MAX_FRACTION)),
        escalated: usage.escalated,
        paused: status.status === "cost_paused",
      };
    })();
    sessions.set(sessionId, loading);
    return loading;
  };

  let done = 0;
  let failed = 0;
  const touchedSessions = new Set<string>();

  const limit = pLimit(concurrency);
  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        touchedSessions.add(job.session_id);
        const outcome = await runJob(job, { db, vision, frameUrl, prepareImage, loadSession });
        if (outcome === "done") done++;
        else failed++;
      }),
    ),
  );

  await rollupDrainedSessions(db, emitSubmission);

  return {
    claimed: jobs.length,
    done,
    failed,
    remaining: await db.pendingJobCount().catch(() => 0),
  };
}

type JobDeps = {
  db: CaptureDb;
  vision: VisionClient;
  frameUrl: (storagePath: string) => string;
  prepareImage: ImagePreparer;
  loadSession: (sessionId: string) => Promise<SessionState>;
};

async function runJob(job: ClaimedJob, deps: JobDeps): Promise<"done" | "failed"> {
  const { db, vision, frameUrl, prepareImage, loadSession } = deps;

  // The claim RPC increments attempts, so this counts claims. A job whose worker
  // died mid-call still converges on failure instead of being retried forever.
  if (job.attempts > MAX_JOB_ATTEMPTS) {
    await db.failJob(job.frame_id, "failed", `attempts_exhausted after ${job.attempts}`);
    return "failed";
  }

  let session: SessionState;
  try {
    session = await loadSession(job.session_id);
  } catch (err) {
    await db.failJob(job.frame_id, "pending", `session_load: ${errText(err)}`);
    return "failed";
  }

  // Another frame in this batch already tripped the breaker for this session.
  // Requeue rather than fail: the frame is fine, the budget is not, and a human
  // resuming the session should find work waiting.
  if (session.paused) {
    await db.failJob(job.frame_id, "pending", "session_cost_paused");
    return "failed";
  }

  if (session.inputTokens >= session.budget) {
    await pauseSession(db, job.session_id, session, `session_budget_exhausted (${session.inputTokens}/${session.budget})`);
    await db.failJob(job.frame_id, "pending", "session_budget_exhausted");
    return "failed";
  }

  let url: string;
  try {
    url = frameUrl(job.storage_path);
  } catch (err) {
    await db.failJob(job.frame_id, "failed", `frame_url: ${errText(err)}`);
    return "failed";
  }

  // Fetched and shrunk once, then reused if this frame escalates: the stronger
  // model is asked about the same 512 px image, not sent back to storage for the
  // full-resolution original.
  let preparing: Promise<string> | null = null;
  const prepareOnce: ImagePreparer = (u) => (preparing ??= prepareImage(u));

  const model = visionModel();
  const first = await extractFrame(vision, url, model, { prepareImage: prepareOnce });
  session.inputTokens += first.usage.inputTokens;

  if (first.kind === "overbudget") {
    // THE BREAKER. The response may have been perfectly good; the price was not.
    // Stop the whole session rather than retry the frame.
    await pauseSession(
      db,
      job.session_id,
      session,
      `frame billed ${first.inputTokens} input tokens, over a ceiling of ${first.ceiling}`,
    );
    await db.failJob(
      job.frame_id,
      "failed_overbudget",
      `input_tokens=${first.inputTokens} exceeds the per-frame ceiling of ${first.ceiling}`,
    );
    return "failed";
  }

  if (first.kind === "failed") {
    // A retryable failure goes back to pending until the attempts cap; past it,
    // it is failed for good.
    const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
    await db.failJob(job.frame_id, terminal ? "failed" : "pending", first.reason);
    return "failed";
  }

  // Escalation: the cheap model answered, but hedged on something it claimed to
  // see. Ask the stronger model once, if this session can still afford to.
  let result = first;
  let escalated = false;
  if (shouldEscalate(first.observation) && session.escalated < session.escalationCap) {
    session.escalated++;
    const second = await extractFrame(vision, url, escalationModel(), {
      prepareImage: prepareOnce,
    });
    session.inputTokens += second.usage.inputTokens;

    if (second.kind === "overbudget") {
      await pauseSession(
        db,
        job.session_id,
        session,
        `escalated frame billed ${second.inputTokens} input tokens, over a ceiling of ${second.ceiling}`,
      );
      await db.failJob(
        job.frame_id,
        "failed_overbudget",
        `escalation input_tokens=${second.inputTokens} exceeds the per-frame ceiling of ${second.ceiling}`,
      );
      return "failed";
    }

    if (second.kind === "ok") {
      result = second;
      escalated = true;
    }
    // A failed escalation is not a failed frame: the cheap model's answer still
    // stands, and it is better than nothing. The hedge is recorded in the
    // per-item confidences either way.
  }

  try {
    await db.completeJob({
      frameId: job.frame_id,
      model: result.model,
      items: result.observation.items,
      usable: result.observation.frameQuality.usable,
      confidence: observationConfidence(result.observation),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      escalated,
    });
  } catch (err) {
    await db.failJob(job.frame_id, "pending", `complete_job: ${errText(err)}`);
    return "failed";
  }

  // Budget check AFTER the spend is recorded, not only before it.
  //
  // The pre-check above stops a frame from STARTING once the budget is gone,
  // which is worth nothing on the last frame of a session: there is no next
  // frame to block, so a session could overrun its cap and still finish
  // review_ready with the overrun never surfacing. Checking here means an
  // exceeded budget always ends as cost_paused in front of a human.
  //
  // The observation is written first on purpose — the frame is already paid for,
  // and throwing away data we have been billed for helps nobody.
  if (session.inputTokens > session.budget) {
    await pauseSession(
      db,
      job.session_id,
      session,
      `session budget exhausted (${session.inputTokens}/${session.budget} input tokens)`,
    );
  }

  return "done";
}

/**
 * Stop a session from claiming further work.
 *
 * Both halves matter: the in-memory flag stops the frames already in flight in
 * THIS pump, and the status write stops the next pump's claim RPC from handing
 * out any more of this session's jobs (0015 only claims from `extracting`).
 * Without the first, seven more frames would bill while the write lands.
 */
async function pauseSession(
  db: CaptureDb,
  sessionId: string,
  session: SessionState,
  reason: string,
): Promise<void> {
  session.paused = true;
  try {
    await db.setSessionStatus(sessionId, "cost_paused");
  } catch {
    // Swallowed on purpose: the in-memory pause already stopped this batch, and
    // throwing here would abandon the remaining jobs mid-flight without closing
    // them out. The next claim retries the write.
  }
  console.warn(`[capture] session ${sessionId} cost_paused: ${reason}`);
}

/**
 * Roll up any session whose queue has drained.
 *
 * Bounded per call so a backlog cannot turn one pump into an unbounded fan-out,
 * and tolerant of failure: a session that fails to roll up stays `extracting`
 * and is retried on the next pump rather than blocking the others.
 */
async function rollupDrainedSessions(
  db: CaptureDb,
  emitSubmission: (sessionId: string) => Promise<void>,
): Promise<void> {
  let sessionIds: string[];
  try {
    sessionIds = await db.drainedSessions(ROLLUP_BATCH_SIZE);
  } catch {
    return;
  }

  for (const sessionId of sessionIds) {
    try {
      await rollupSession(db, sessionId, emitSubmission);
    } catch (err) {
      console.warn(`[capture] rollup failed for ${sessionId}: ${errText(err)}`);
    }
  }
}

/** Aggregate one session and mark it ready for a human. Exported for tests. */
export async function rollupSession(
  db: CaptureDb,
  sessionId: string,
  emitSubmission: (sessionId: string) => Promise<void>,
): Promise<number> {
  const rows = await db.listObservations(sessionId);

  const observations: RollupObservation[] = rows.map((r) => ({
    frameId: r.frame_id,
    segmentId: r.segment_id,
    model: r.model,
    items: r.items,
    usable: r.usable,
    escalated: r.escalated,
    nearJunction: r.near_junction,
  }));

  const rollups = computeRollups(observations);

  for (const rollup of rollups) {
    await db.upsertRollup({
      sessionId,
      segmentId: rollup.segmentId,
      scores: rollup.scores,
      itemMedians: rollup.itemMedians,
      coverage: rollup.coverage,
      confidence: rollup.confidence,
    });
  }

  // File it into the review queue BEFORE flipping the status, because the status
  // write below is a one-way latch: drainedSessions only selects `extracting`, so
  // a session that reaches review_ready is never drained again. Emitting after it
  // would mean a throw here strands a finished walk with no queue row and no
  // retry — invisible to every human forever. Emitting first means a throw simply
  // leaves the session `extracting` for the next pump, and the emit is idempotent
  // precisely so that retry is free. Ordering mirrors reviewSubmission's "land the
  // data first" rule (lib/submissions.ts).
  await emitSubmission(sessionId);

  // review_ready even with zero rollups: a session where every frame failed has
  // finished extracting and needs a human to look at it, which is exactly what
  // review_ready means. Leaving it `extracting` would strand it forever. It is
  // filed above for the same reason — a walk that produced nothing is still a
  // walk someone should be told about.
  await db.setSessionStatus(sessionId, "review_ready");
  return rollups.length;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
