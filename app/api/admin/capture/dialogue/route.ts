/**
 * POST /api/admin/capture/dialogue — converse or recompute with the synthesis model.
 *
 * Text-only; no vision. Assembles context fresh per call (rollup + spatial +
 * referenced frames + transcript). Persists chat; on recompute updates
 * assessment EN+ES and returns manual score patch for the workbench.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { getCaptureDb } from "@/lib/capture/db";
import { getSessionReview } from "@/lib/capture/review-store";
import { EMPTY_CORRECTIONS, type ReviewCorrections } from "@/lib/capture/review-overrides";
import { runSegmentDialogue } from "@/lib/capture/run-dialogue";
import { RUBRIC_ITEM_KEYS } from "@/lib/capture/types";
import { LENS_KEYS } from "@/lib/capture/scoring";
import { getSegments } from "@/lib/segments";
import type { MatchSegment } from "@/lib/matching/types";
import type { SegmentGeometryMeta } from "@/lib/capture/dialogue-spatial";
import { listReviewDialogues } from "@/lib/capture/dialogue-store";

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
  message: z.string().min(1).max(8000),
  mode: z.enum(["converse", "recompute"]),
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
    const parsed = lenses.filter((l) =>
      LENS_KEYS.includes(l as (typeof LENS_KEYS)[number]),
    ) as (typeof LENS_KEYS)[number][];
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

async function loadNetworkContext(segmentId: string): Promise<{
  segmentMeta: SegmentGeometryMeta | null;
  network: MatchSegment[];
  nameById: Map<string, string>;
}> {
  const nameById = new Map<string, string>();
  try {
    const collection = await getSegments();
    const network: MatchSegment[] = collection.features.map((f) => ({
      id: f.properties.id,
      coordinates: f.geometry.coordinates.map((c) => [c[0], c[1]] as [number, number]),
    }));
    let segmentMeta: SegmentGeometryMeta | null = null;
    for (const f of collection.features) {
      const id = f.properties.id;
      if (f.properties.name) nameById.set(id, f.properties.name);
      if (id === segmentId) {
        segmentMeta = {
          id,
          name: f.properties.name,
          district: f.properties.district,
          highway: f.properties.highway ?? null,
          lengthM: f.properties.length_m ?? null,
          coordinates: f.geometry.coordinates.map((c) => [c[0], c[1]] as [number, number]),
        };
      }
    }
    return { segmentMeta, network, nameById };
  } catch {
    return { segmentMeta: null, network: [], nameById };
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const sessionId = request.nextUrl.searchParams.get("session_id");
  const segmentId = request.nextUrl.searchParams.get("segment_id");
  if (!sessionId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const messages = await listReviewDialogues(sessionId, segmentId);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    console.error("[capture dialogue] list failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
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
  const { session_id, segment_id, message, mode } = parsed.data;
  const corrections = parseCorrections(parsed.data.corrections);

  const review = await getSessionReview(session_id);
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (review.status === "approved" || review.status === "rejected") {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }

  const { segmentMeta, network, nameById } = await loadNetworkContext(segment_id);

  try {
    const result = await runSegmentDialogue({
      db,
      review,
      segmentId: segment_id,
      message,
      mode,
      corrections,
      segmentMeta,
      network,
      nameById,
    });

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      assistant_message: result.assistantMessage,
      suggest_recompute: result.suggestRecompute,
      clarifying_question: result.clarifyingQuestion,
      messages: result.messages,
      assessment: result.assessment ?? null,
      assessment_es: result.assessmentEs ?? null,
      manual_scores: result.manualScores ?? null,
      provenance: result.provenance ?? null,
      tokens: {
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
      },
      model: result.model,
      referenced_seqs: result.referencedSeqs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "extraction_disabled") {
      return NextResponse.json({ error: "extraction_disabled" }, { status: 503 });
    }
    if (/segment_not_found|no_frames_for_dialogue|empty_message/.test(msg)) {
      return NextResponse.json({ error: "bad_segment", detail: msg }, { status: 409 });
    }
    if (/converse_failed|recompute_failed/.test(msg)) {
      return NextResponse.json({ error: "model_failed", detail: msg }, { status: 502 });
    }
    console.error("[capture dialogue] failed:", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
