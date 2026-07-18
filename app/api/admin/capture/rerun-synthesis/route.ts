/**
 * POST /api/admin/capture/rerun-synthesis — re-run analysis on curated frames.
 *
 * Closes backlog #13: one synthesis call per segment after reviewer curation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { getCaptureDb } from "@/lib/capture/db";
import { getSessionReview } from "@/lib/capture/review-store";
import { EMPTY_CORRECTIONS, type ReviewCorrections } from "@/lib/capture/review-overrides";
import { rerunSegmentSynthesis } from "@/lib/capture/rerun-synthesis";
import { RUBRIC_ITEM_KEYS } from "@/lib/capture/types";
import { LENS_KEYS } from "@/lib/capture/scoring";

export const runtime = "nodejs";

const correctionsSchema = z.object({
  itemOverrides: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.null()]))).optional(),
  excluded: z.array(z.number()).optional(),
  deleted: z.array(z.number()).optional(),
  manualScores: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.null()]))).optional(),
  baselineLenses: z.record(z.string(), z.array(z.string())).optional(),
});

const bodySchema = z.object({
  session_id: z.string().uuid(),
  segment_id: z.string().min(1),
  corrections: correctionsSchema.optional(),
});

function parseCorrections(raw: z.infer<typeof correctionsSchema> | undefined): ReviewCorrections {
  if (!raw) return EMPTY_CORRECTIONS;
  const itemOverrides: ReviewCorrections["itemOverrides"] = {};
  for (const [seqStr, items] of Object.entries(raw.itemOverrides ?? {})) {
    const seq = Number(seqStr);
    if (!Number.isFinite(seq)) continue;
    const parsed: Partial<Record<(typeof RUBRIC_ITEM_KEYS)[number], number | null>> = {};
    for (const [key, val] of Object.entries(items)) {
      if (RUBRIC_ITEM_KEYS.includes(key as (typeof RUBRIC_ITEM_KEYS)[number])) {
        parsed[key as (typeof RUBRIC_ITEM_KEYS)[number]] = val;
      }
    }
    if (Object.keys(parsed).length > 0) itemOverrides[seq] = parsed;
  }

  const manualScores: ReviewCorrections["manualScores"] = {};
  for (const [segId, scores] of Object.entries(raw.manualScores ?? {})) {
    const parsed: Partial<Record<(typeof LENS_KEYS)[number], number | null>> = {};
    for (const [key, val] of Object.entries(scores)) {
      if (LENS_KEYS.includes(key as (typeof LENS_KEYS)[number])) {
        parsed[key as (typeof LENS_KEYS)[number]] = val;
      }
    }
    if (Object.keys(parsed).length > 0) manualScores[segId] = parsed;
  }

  const baselineLenses: ReviewCorrections["baselineLenses"] = {};
  for (const [segId, lenses] of Object.entries(raw.baselineLenses ?? {})) {
    const parsed = lenses.filter((l) => LENS_KEYS.includes(l as (typeof LENS_KEYS)[number])) as (typeof LENS_KEYS)[number][];
    if (parsed.length > 0) baselineLenses[segId] = parsed;
  }

  return {
    itemOverrides,
    excluded: raw.excluded ?? [],
    deleted: raw.deleted ?? [],
    manualScores,
    baselineLenses,
  };
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const db = getCaptureDb();
  if (!db) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { session_id, segment_id } = parsed.data;
  const corrections = parseCorrections(parsed.data.corrections);

  const review = await getSessionReview(session_id);
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (review.status === "approved" || review.status === "rejected") {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }

  try {
    const result = await rerunSegmentSynthesis({
      db,
      review,
      segmentId: segment_id,
      corrections,
    });
    return NextResponse.json({
      ok: true,
      segment_id,
      assessment: result.assessment,
      tokens: {
        input: result.inputTokens,
        output: result.outputTokens,
      },
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "extraction_disabled") {
      return NextResponse.json({ error: "extraction_disabled" }, { status: 503 });
    }
    if (/segment_not_found|no_frames_for_synthesis/.test(message)) {
      return NextResponse.json({ error: "no_frames" }, { status: 409 });
    }
    if (/synthesis_failed/.test(message)) {
      return NextResponse.json({ error: "synthesis_failed", detail: message }, { status: 502 });
    }
    console.error("[capture rerun-synthesis] failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
