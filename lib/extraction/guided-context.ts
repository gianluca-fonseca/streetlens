/**
 * Stateless context assembly for reviewer dialogue.
 *
 * Every call builds EXACTLY what that call needs — segment rollup, a compact
 * textual spatial block (no images), evidence lines for referenced frames only,
 * and a transcript tail — then truncates oldest turns first to stay under the
 * input token cap. Nothing is cached server-side between turns beyond the
 * persisted chat text itself (owner extension, bgsd-0015).
 *
 * Pure core: all geometry/meta arrive as inputs so tests drive real assembly
 * without loading GeoJSON or hitting a database.
 */

import type { LensScores } from "@/lib/capture/scoring";
import type { ItemMedian } from "@/lib/capture/rollup";
import type { SegmentAssessment, SegmentAssessmentEs } from "@/lib/capture/schemas";
import type { SynthesisFrame } from "./synthesis";
import { haversineMeters } from "./synthesis";
import { referencedSeqs } from "./guided-frame-refs";

/** Soft input cap per dialogue call (~8k tokens). Override via env in the orchestrator. */
export const DIALOGUE_INPUT_TOKEN_CAP = 8000;

/** Rough token estimate: ~4 chars per token for English+JSON-ish text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export type DialogueRole = "reviewer" | "assistant" | "system";

export type DialogueTurn = {
  role: DialogueRole;
  content: string;
  /** True when this turn triggered a recompute. */
  recompute?: boolean;
};

export type SpatialSegmentIdentity = {
  id: string;
  name: string | null;
  district: string | null;
  highway: string | null;
  lengthM: number | null;
};

export type SpatialNeighbors = {
  /** Neighboring segment display names (or ids) at the geometry start node. */
  atStart: string[];
  /** Neighboring segment display names (or ids) at the geometry end node. */
  atEnd: string[];
};

export type FrameAlongSegment = {
  seq: number;
  /** Metres along the segment geometry from its start vertex, when known. */
  alongM: number | null;
  /** Fraction 0–1 along the segment, when length is known. */
  fraction: number | null;
  nearJunction: boolean;
  location: { lng: number; lat: number } | null;
};

export type SpatialBlockInput = {
  identity: SpatialSegmentIdentity;
  /** Walk direction label, e.g. "along geometry start→end" or "unknown". */
  direction: string;
  frameCount: number;
  coveragePct: number | null;
  matchConfidence: number | null;
  /** Frames at start / middle / end thirds of the segment (by along-fraction). */
  anchors: { start: number[]; middle: number[]; end: number[] };
  neighbors: SpatialNeighbors;
  /** Per-referenced-frame position facts (built for cited seqs only). */
  referencedPositions: FrameAlongSegment[];
};

export type DialogueRollupContext = {
  segmentId: string;
  baselineScores: LensScores;
  /** Scores currently shown (after synthesis / manual). */
  currentScores: LensScores;
  itemMedians: Record<string, ItemMedian>;
  assessment: SegmentAssessment | null;
  assessmentEs: SegmentAssessmentEs | null;
  coverage: number | null;
  confidence: number | null;
};

export type AssembleDialogueContextArgs = {
  rollup: DialogueRollupContext;
  spatial: SpatialBlockInput;
  /** All segment frames (for evidence lines); only referenced ones are emitted. */
  frames: readonly SynthesisFrame[];
  /** Transcript so far, oldest first. The NEW user message is typically last. */
  transcript: readonly DialogueTurn[];
  /** The latest user message whose #N refs select evidence frames. */
  latestUserMessage: string;
  tokenCap?: number;
};

export type AssembledDialogueContext = {
  /** Full user-turn payload sent to the model (rollup + spatial + frames + transcript). */
  userPayload: string;
  /** Token estimate of userPayload. */
  estimatedTokens: number;
  /** Seq numbers whose evidence lines were included. */
  referencedSeqs: number[];
  /** How many oldest transcript turns were dropped to fit the cap. */
  truncatedTurns: number;
  /** Spatial block text alone (for tests / logging). */
  spatialBlock: string;
  rollupBlock: string;
};

const round = (v: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function scoresLine(label: string, scores: LensScores): string {
  const order = ["overall", "accessibility", "drainage", "shade", "bike"] as const;
  return `${label}: ${order.map((k) => `${k}=${scores[k] === null ? "null" : scores[k]}`).join(", ")}`;
}

function mediansBlock(medians: Record<string, ItemMedian>): string {
  const keys = Object.keys(medians).sort();
  if (keys.length === 0) return "  (none)";
  return keys
    .map((k) => {
      const m = medians[k];
      return `  ${k}=median ${m.value} (conf ${m.confidence ?? "?"}, ${m.frames} frames)`;
    })
    .join("\n");
}

function assessmentBlock(
  assessment: SegmentAssessment | null,
  assessmentEs: SegmentAssessmentEs | null,
): string {
  if (!assessment) return "CURRENT ASSESSMENT: (none)";
  const lines = [
    `CURRENT ASSESSMENT (EN): ${assessment.overall}`,
    `  accessibility: ${assessment.lenses.accessibility}`,
    `  drainage: ${assessment.lenses.drainage}`,
    `  shade: ${assessment.lenses.shade}`,
    `  bike: ${assessment.lenses.bike}`,
  ];
  if (assessmentEs?.overall) {
    lines.push(`CURRENT ASSESSMENT (ES): ${assessmentEs.overall}`);
  }
  const adjKeys = Object.keys(assessment.adjustments ?? {});
  if (adjKeys.length > 0) {
    lines.push(
      `PRIOR ADJUSTMENTS: ${adjKeys
        .map((k) => {
          const a = assessment.adjustments?.[k as keyof typeof assessment.adjustments];
          return a ? `${k} Δ${a.delta} (${a.reason})` : k;
        })
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

/** Compact textual map context — rebuilt fresh every call, never persisted as standing state. */
export function buildSpatialBlock(spatial: SpatialBlockInput): string {
  const id = spatial.identity;
  const length =
    id.lengthM !== null && Number.isFinite(id.lengthM) ? `${round(id.lengthM)}m` : "?m";
  const coverage =
    spatial.coveragePct === null ? "?" : `${round(spatial.coveragePct * 100, 0)}%`;
  const conf =
    spatial.matchConfidence === null ? "?" : `${round(spatial.matchConfidence, 2)}`;

  const fmtAnchors = (seqs: number[]) =>
    seqs.length ? seqs.map((s) => `#${s}`).join(",") : "(none)";

  const neighborLine = (label: string, names: string[]) =>
    `  ${label}: ${names.length ? names.join(", ") : "(none recorded)"}`;

  const refLines = spatial.referencedPositions.map((p) => {
    const pct =
      p.fraction !== null && Number.isFinite(p.fraction)
        ? `≈ ${round(p.fraction * 100, 0)}% along`
        : "position unknown";
    const metres =
      p.alongM !== null && Number.isFinite(p.alongM) ? ` (~${round(p.alongM)}m from start)` : "";
    const junc = p.nearJunction ? ", near a junction" : "";
    return `  frame #${p.seq}: ${pct}${metres}${junc}`;
  });

  return [
    `SPATIAL (textual; no images — assembled fresh for this call only):`,
    `  segment: ${id.name ?? id.id} (${id.id})`,
    `  district: ${id.district ?? "?"}; highway: ${id.highway ?? "?"}; length: ${length}`,
    `  traversal: ${spatial.direction}; ${spatial.frameCount} frames; coverage ${coverage}; match confidence ${conf}`,
    `  anchors along segment: start ${fmtAnchors(spatial.anchors.start)}; middle ${fmtAnchors(spatial.anchors.middle)}; end ${fmtAnchors(spatial.anchors.end)}`,
    `  neighbors:`,
    neighborLine("at start", spatial.neighbors.atStart),
    neighborLine("at end", spatial.neighbors.atEnd),
    refLines.length
      ? `  referenced frame positions:\n${refLines.join("\n")}`
      : `  referenced frame positions: (none cited)`,
  ].join("\n");
}

export function buildRollupBlock(rollup: DialogueRollupContext): string {
  return [
    `SEGMENT ROLLUP ${rollup.segmentId}`,
    scoresLine("BASELINE", rollup.baselineScores),
    scoresLine("CURRENT", rollup.currentScores),
    `coverage=${rollup.coverage ?? "null"} confidence=${rollup.confidence ?? "null"}`,
    `ITEM MEDIANS:`,
    mediansBlock(rollup.itemMedians),
    assessmentBlock(rollup.assessment, rollup.assessmentEs),
  ].join("\n");
}

/**
 * One frame's evidence line for dialogue — same spirit as synthesis frameLine,
 * but only emitted for cited frames (token lean).
 */
export function dialogueFrameEvidenceLine(frame: SynthesisFrame, along: FrameAlongSegment | null): string {
  const parts: string[] = [`#${frame.seq}`];
  if (along?.fraction !== null && along?.fraction !== undefined) {
    parts.push(`@${round(along.fraction * 100, 0)}%`);
    if (along.alongM !== null) parts.push(`(~${round(along.alongM)}m)`);
  } else if (frame.location) {
    parts.push(`@gps`);
  } else {
    parts.push(`@?`);
  }
  if (frame.nearJunction || along?.nearJunction) parts.push("JUNCTION");
  if (!frame.usable) parts.push("UNUSABLE");

  const readings: string[] = [];
  for (const [key, item] of Object.entries(frame.items)) {
    if (item.value === null || item.value === undefined || !Number.isFinite(item.value)) continue;
    readings.push(`${key}=${item.value}@${round(item.confidence, 2)}`);
  }
  const body = readings.length ? readings.join(" ") : "no assessable items";
  const rationale = frame.rationale?.trim() ? ` :: ${frame.rationale.trim()}` : "";
  return `${parts.join(" ")} | ${body}${rationale}`;
}

function transcriptBlock(turns: readonly DialogueTurn[]): string {
  if (turns.length === 0) return "TRANSCRIPT: (empty)";
  const lines = turns.map((t) => {
    const tag = t.recompute ? " [recompute]" : "";
    return `${t.role.toUpperCase()}${tag}: ${t.content}`;
  });
  return `TRANSCRIPT (oldest→newest):\n${lines.join("\n")}`;
}

/**
 * Place frames into start / middle / end thirds by fraction along the segment.
 * Frames without a known fraction are omitted from anchors.
 */
export function classifyAnchors(
  positions: readonly FrameAlongSegment[],
): { start: number[]; middle: number[]; end: number[] } {
  const start: number[] = [];
  const middle: number[] = [];
  const end: number[] = [];
  for (const p of positions) {
    if (p.fraction === null || !Number.isFinite(p.fraction)) continue;
    if (p.fraction < 1 / 3) start.push(p.seq);
    else if (p.fraction < 2 / 3) middle.push(p.seq);
    else end.push(p.seq);
  }
  return { start, middle, end };
}

/**
 * Metres along a polyline from its first vertex to the nearest point to `loc`.
 * Returns null when the polyline is unusable or the location is missing.
 */
export function metersAlongPolyline(
  coordinates: ReadonlyArray<readonly [number, number]>,
  loc: { lng: number; lat: number } | null,
): number | null {
  if (!loc || coordinates.length < 2) return null;
  let bestDist = Infinity;
  let bestAlong = 0;
  let cumulative = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const b = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };
    const segLen = haversineMeters(a, b);
    // Project loc onto segment ab (planar local approx is fine at street scale).
    const ax = a.lng;
    const ay = a.lat;
    const bx = b.lng;
    const by = b.lat;
    const px = loc.lng;
    const py = loc.lat;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    const d = haversineMeters(loc, { lng: qx, lat: qy });
    if (d < bestDist) {
      bestDist = d;
      bestAlong = cumulative + t * segLen;
    }
    cumulative += segLen;
  }
  return bestAlong;
}

/**
 * Assemble the dialogue user payload under the token cap.
 *
 * Priority when truncating: keep rollup + spatial + referenced frame evidence
 * intact; drop oldest transcript turns first. If still over budget after an
 * empty transcript, truncate the evidence block from the end (rare; means the
 * reviewer cited too many frames).
 */
export function assembleDialogueContext(
  args: AssembleDialogueContextArgs,
): AssembledDialogueContext {
  const cap = args.tokenCap ?? DIALOGUE_INPUT_TOKEN_CAP;
  const knownSeqs = args.frames.map((f) => f.seq);
  const refs = referencedSeqs(args.latestUserMessage, knownSeqs);

  const frameBySeq = new Map(args.frames.map((f) => [f.seq, f]));
  const posBySeq = new Map(args.spatial.referencedPositions.map((p) => [p.seq, p]));

  // Ensure spatial referencedPositions cover cited seqs (caller may have pre-filled).
  const spatial: SpatialBlockInput = {
    ...args.spatial,
    referencedPositions: refs.map((seq) => {
      const existing = posBySeq.get(seq);
      if (existing) return existing;
      const f = frameBySeq.get(seq);
      return {
        seq,
        alongM: null,
        fraction: null,
        nearJunction: f?.nearJunction ?? false,
        location: f?.location ?? null,
      };
    }),
  };

  const rollupBlock = buildRollupBlock(args.rollup);
  const spatialBlock = buildSpatialBlock(spatial);

  const evidenceLines = refs.map((seq) => {
    const f = frameBySeq.get(seq);
    if (!f) return `  #${seq} | (frame not on this segment)`;
    return `  ${dialogueFrameEvidenceLine(f, posBySeq.get(seq) ?? null)}`;
  });
  const evidenceBlock = [
    `REFERENCED FRAME EVIDENCE (only frames the reviewer cited; synthesis observation lines):`,
    evidenceLines.length ? evidenceLines.join("\n") : "  (no valid #N refs in the latest message)",
  ].join("\n");

  const fixedHead = [rollupBlock, "", spatialBlock, "", evidenceBlock].join("\n");
  const fixedTokens = estimateTokens(fixedHead);

  let turns = [...args.transcript];
  let truncatedTurns = 0;

  const pack = (t: DialogueTurn[]) =>
    [fixedHead, "", transcriptBlock(t)].join("\n");

  while (turns.length > 0 && estimateTokens(pack(turns)) > cap) {
    turns = turns.slice(1);
    truncatedTurns += 1;
  }

  let userPayload = pack(turns);

  // Extreme: fixed head alone exceeds cap — trim evidence lines from the end.
  if (estimateTokens(userPayload) > cap && evidenceLines.length > 0) {
    let kept = [...evidenceLines];
    while (kept.length > 1 && estimateTokens(userPayload) > cap) {
      kept = kept.slice(0, -1);
      const trimmedEvidence = [
        `REFERENCED FRAME EVIDENCE (truncated to fit token cap):`,
        kept.join("\n"),
      ].join("\n");
      userPayload = [rollupBlock, "", spatialBlock, "", trimmedEvidence, "", transcriptBlock(turns)].join(
        "\n",
      );
    }
  }

  // Absolute last resort: hard-slice the payload (should be rare).
  if (estimateTokens(userPayload) > cap) {
    const maxChars = cap * 4;
    userPayload = userPayload.slice(0, maxChars);
  }

  return {
    userPayload,
    estimatedTokens: estimateTokens(userPayload),
    referencedSeqs: refs,
    truncatedTurns,
    spatialBlock,
    rollupBlock,
  };
}

/** Expose fixed-head size for tests asserting the cap keeps rollup+spatial. */
export function fixedContextTokenEstimate(
  rollup: DialogueRollupContext,
  spatial: SpatialBlockInput,
  evidenceLineCount = 0,
): number {
  const evidence =
    evidenceLineCount <= 0
      ? "REFERENCED FRAME EVIDENCE:\n  (none)"
      : `REFERENCED FRAME EVIDENCE:\n${Array.from({ length: evidenceLineCount }, (_, i) => `  #${i + 1} | stub`).join("\n")}`;
  return estimateTokens(
    [buildRollupBlock(rollup), "", buildSpatialBlock(spatial), "", evidence].join("\n"),
  );
}
