/**
 * The read model behind the admin capture-review page (u30).
 *
 * WHY THIS EXISTS, and why it is read-only:
 *
 * The capture stack has no local mode by design — `getCaptureDb()` returns null
 * without Supabase and every capture route answers 503, because there is no
 * honest static fallback for "record my walk" (lib/capture/db.ts). That rule is
 * about WRITES and it stands: nothing here lets you record a session offline.
 *
 * Reading a session for review is a different question, and it has the same shape
 * as the map's read path, which has always been live-else-static
 * (lib/segments.ts: liveScoreRows() else the demo collection). So this mirrors
 * that: the RPC when a database is configured, otherwise a fixture file. That is
 * what lets the review loop be driven end to end — and screenshotted — without a
 * database, exactly as the map is.
 *
 * The fixture holds the SAME shape the RPC returns, so the local path exercises
 * the real page against real-shaped data rather than a page-specific mock.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "@/lib/supabase";
import { publicFrameUrl } from "./storage";
import { readCaptureReviewOverlay } from "./review-actions";
import type { CaptureSessionStatus } from "./types";
import type { FrameObservation } from "./review-overrides";

export type { FrameObservation };

const FIXTURE_PATH = path.join(
  process.cwd(),
  "data",
  "capture-review.local.json",
);

/** One rubric item's median, as the rollup stored it. */
export type ReviewItemMedian = {
  value: number | null;
  confidence: number | null;
  frames: number;
};

/** One segment of a walk, with everything an admin needs to judge it. */
export type ReviewSegment = {
  segmentId: string;
  scores: Record<string, number | null>;
  itemMedians: Record<string, ReviewItemMedian>;
  coverage: number | null;
  confidence: number | null;
  /** Frames the model escalated to the stronger model on this segment. */
  escalated: number;
  frames: ReviewFrame[];
};

/** Where a frame sits on the ground, as MapLibre wants it: [lng, lat]. */
export type FramePosition = { lng: number; lat: number };

export type ReviewFrame = {
  seq: number;
  storagePath: string;
  /** Public bucket URL, or null when it cannot be built (no Supabase URL set). */
  url: string | null;
  /** The street this frame was attributed to, or null when it matched none. */
  segmentId: string | null;
  /**
   * Junction frames source the two junction-sensitive items (curb_ramp,
   * crossing_safety); mid-block frames source the other thirteen. The recompute
   * needs this exactly as the server rollup does (lib/capture/rollup.ts).
   */
  nearJunction: boolean;
  /** Whether the frame was clear enough to score. Drives coverage, per the rollup. */
  usable: boolean;
  /** Ground position for the review map. Null when unknown (unmatched/old fixture). */
  position: FramePosition | null;
  /** The frozen per-frame reading, or null when none. See {@link FrameObservation}. */
  observation: FrameObservation | null;
  /**
   * A tombstone: the frame's bytes were hard-deleted by a reviewer for privacy.
   * The seq stays so the record never lies about how many frames a walk had, but
   * a deleted frame never scores.
   */
  deleted: boolean;
};

export type SessionReview = {
  sessionId: string;
  status: CaptureSessionStatus;
  frameCount: number;
  /** When the walk happened, not when it was reviewed. */
  capturedOn: string | null;
  reviewedAt: string | null;
  jobs: { pending: number; done: number; failed: number; overbudget: number };
  tokens: {
    inputTokens: number;
    outputTokens: number;
    observations: number;
    escalated: number;
  };
  segments: ReviewSegment[];
  /**
   * Every frame of the walk in seq order, attributed or not, deleted or not. The
   * segment cards read the grouped {@link ReviewSegment.frames}; the map panel and
   * the override recompute read this full list.
   */
  frames: ReviewFrame[];
  /** The GPS track of the walk as a polyline, for the review map. Empty if unknown. */
  track: FramePosition[];
  /** Frames no segment could be attributed to. Counted, never hidden. */
  unattributedFrames: number;
  /**
   * The money ran out: the session was paused mid-extraction, or some frames
   * were failed for budget. Distinct from `failed`, which means the frame was bad.
   */
  overbudget: boolean;
  source: "live" | "fixture";
};

/** The raw RPC/fixture payload, before frames are grouped onto segments. */
type ReviewPayload = {
  sessionId: string;
  status: CaptureSessionStatus;
  frameCount: number | null;
  capturedOn: string | null;
  reviewedAt: string | null;
  jobs: { pending: number; done: number; failed: number; overbudget: number };
  tokens: {
    inputTokens: number;
    outputTokens: number;
    observations: number;
    escalated: number;
  };
  rollups: {
    segmentId: string;
    scores: Record<string, number | null>;
    itemMedians: Record<string, ReviewItemMedian> | null;
    coverage: number | null;
    confidence: number | null;
    escalated: number | null;
  }[];
  frames: {
    seq: number;
    storagePath: string;
    segmentId: string | null;
    /**
     * Fixture-only escape hatch: a ready-made URL for a frame.
     *
     * The live RPC never sets this — it returns storage paths and the app builds
     * bucket URLs, so the database stays ignorant of deployment URLs. A local
     * fixture has no bucket to build from, so it may point frames at a local
     * asset and get a real filmstrip to look at.
     */
    url?: string | null;
    /**
     * The rest are merged in from `capture_session_review_detail` (u2 migration
     * 0021) at fetch time, or carried directly in the fixture. All optional so an
     * un-upgraded payload still parses.
     */
    nearJunction?: boolean;
    usable?: boolean;
    position?: FramePosition | null;
    observation?: FrameObservation | null;
    deleted?: boolean;
  }[];
  /** GPS track polyline, from `capture_session_review_detail` or the fixture. */
  track?: FramePosition[] | null;
  /** Seqs whose frames were hard-deleted; surfaced as tombstones. */
  tombstones?: { seq: number }[] | null;
};

/** Build a public frame URL, tolerating an unconfigured deployment. */
function frameUrl(storagePath: string): string | null {
  try {
    return publicFrameUrl(storagePath);
  } catch {
    // publicFrameUrl throws without NEXT_PUBLIC_SUPABASE_URL. That is correct for
    // the extraction path (a relative URL would fail at the model provider) but
    // must not take the review page down; the filmstrip degrades to a placeholder.
    return null;
  }
}

/** Numbers arrive from postgres numerics as strings; coerce without inventing. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toReview(payload: ReviewPayload, source: "live" | "fixture"): SessionReview {
  const tombstoned = new Set((payload.tombstones ?? []).map((t) => t.seq));

  const framesBySegment = new Map<string, ReviewFrame[]>();
  const allFrames: ReviewFrame[] = [];
  let unattributed = 0;
  for (const f of payload.frames ?? []) {
    const frame: ReviewFrame = {
      seq: f.seq,
      storagePath: f.storagePath,
      url: f.url ?? frameUrl(f.storagePath),
      segmentId: f.segmentId ?? null,
      nearJunction: f.nearJunction ?? false,
      usable: f.usable ?? true,
      position: f.position ?? null,
      observation: f.observation ?? null,
      deleted: f.deleted ?? tombstoned.has(f.seq),
    };
    allFrames.push(frame);
    if (!f.segmentId) {
      unattributed++;
      continue;
    }
    const list = framesBySegment.get(f.segmentId);
    if (list) list.push(frame);
    else framesBySegment.set(f.segmentId, [frame]);
  }
  allFrames.sort((a, b) => a.seq - b.seq);

  const segments: ReviewSegment[] = (payload.rollups ?? []).map((r) => ({
    segmentId: r.segmentId,
    scores: {
      overall: num(r.scores?.overall),
      accessibility: num(r.scores?.accessibility),
      drainage: num(r.scores?.drainage),
      shade: num(r.scores?.shade),
      bike: num(r.scores?.bike),
    },
    itemMedians: r.itemMedians ?? {},
    coverage: num(r.coverage),
    confidence: num(r.confidence),
    escalated: num(r.escalated) ?? 0,
    frames: framesBySegment.get(r.segmentId) ?? [],
  }));

  const jobs = payload.jobs ?? { pending: 0, done: 0, failed: 0, overbudget: 0 };

  return {
    sessionId: payload.sessionId,
    status: payload.status,
    frameCount: num(payload.frameCount) ?? (payload.frames?.length ?? 0),
    capturedOn: payload.capturedOn ?? null,
    reviewedAt: payload.reviewedAt ?? null,
    jobs: {
      pending: num(jobs.pending) ?? 0,
      done: num(jobs.done) ?? 0,
      failed: num(jobs.failed) ?? 0,
      overbudget: num(jobs.overbudget) ?? 0,
    },
    tokens: {
      inputTokens: num(payload.tokens?.inputTokens) ?? 0,
      outputTokens: num(payload.tokens?.outputTokens) ?? 0,
      observations: num(payload.tokens?.observations) ?? 0,
      escalated: num(payload.tokens?.escalated) ?? 0,
    },
    segments,
    frames: allFrames,
    track: (payload.track ?? []).filter(
      (p): p is FramePosition =>
        !!p && Number.isFinite(p.lng) && Number.isFinite(p.lat),
    ),
    unattributedFrames: unattributed,
    overbudget:
      payload.status === "cost_paused" || (num(jobs.overbudget) ?? 0) > 0,
    source,
  };
}

/** All review-ready sessions in the fixture, for the local-mode queue. */
async function readFixture(): Promise<ReviewPayload[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
    if (Array.isArray(parsed)) return parsed as ReviewPayload[];
    return [parsed as ReviewPayload];
  } catch {
    return [];
  }
}

/**
 * One session, assembled for review. Null when unknown.
 *
 * Live first, fixture second — the same precedence the map's read path uses, so a
 * configured deployment never quietly serves fixture data.
 */
export async function getSessionReview(
  sessionId: string,
): Promise<SessionReview | null> {
  const client = getSupabaseClient();
  const secret = process.env.ADMIN_RPC_SECRET;

  if (client && secret) {
    try {
      const { data, error } = await client.rpc("capture_session_review", {
        p_session_id: sessionId,
        p_secret: secret,
      });
      if (!error && data) {
        return toReview(data as ReviewPayload, "live");
      }
    } catch {
      // fall through to the fixture
    }
  }

  const fixture = await readFixture();
  const found = fixture.find((s) => s.sessionId === sessionId);
  if (!found) return null;

  // The fixture is immutable base data; decisions live in an overlay, exactly as
  // lib/submissions.ts does for the local queue. Without this a locally-approved
  // session would still read `review_ready` and could be approved forever.
  const overlay = await readCaptureReviewOverlay();
  const decision = overlay[sessionId];
  const withDecision: ReviewPayload = decision
    ? { ...found, status: decision.status, reviewedAt: decision.reviewed_at }
    : found;

  return toReview(withDecision, "fixture");
}

/** Session ids present in the fixture. Empty in a live deployment. */
export async function fixtureSessionIds(): Promise<string[]> {
  return (await readFixture()).map((s) => s.sessionId);
}
