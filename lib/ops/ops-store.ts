/**
 * Ops console data loader — bounded RPC reads, no direct table access.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { sessionInputTokensPerFrame, sessionTokenBudget } from "@/lib/extraction/config";
import { aggregateModelQuality, type ModelQualitySummary } from "./model-quality";
import type {
  OpsDailySpend,
  OpsFleetSession,
  OpsHealthSummary,
  OpsModelQualityRow,
  OpsExtractionModelStat,
} from "./types";

function adminSecret(): string | undefined {
  return process.env.ADMIN_RPC_SECRET;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  const client = getSupabaseClient();
  const secret = adminSecret();
  if (!client || !secret) return null;
  const { data, error } = await client.rpc(name, { ...args, p_secret: secret });
  if (error) {
    console.warn(`[ops] ${name}: ${error.message}`);
    return null;
  }
  return data as T;
}

export type OpsDashboardData = {
  source: "live" | "empty";
  health: OpsHealthSummary | null;
  sessions: OpsFleetSession[];
  dailySpend: OpsDailySpend[];
  modelQuality: ModelQualitySummary;
  totals: {
    extractionTokens: number;
    synthesisTokens: number;
    escalationRate: number;
    budgetHeadroomSessions: number;
  };
};

function parseFleetSession(raw: unknown): OpsFleetSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sessionId = typeof r.sessionId === "string" ? r.sessionId : null;
  if (!sessionId) return null;
  const jobs = (r.jobs ?? {}) as Record<string, unknown>;
  const tokens = (r.tokens ?? {}) as Record<string, unknown>;
  return {
    sessionId,
    status: String(r.status ?? "unknown"),
    mode: String(r.mode ?? "unknown"),
    frameCount: Number(r.frameCount) || 0,
    createdAt: String(r.createdAt ?? ""),
    pauseReason: typeof r.pauseReason === "string" ? r.pauseReason : null,
    jobs: {
      pending: Number(jobs.pending) || 0,
      done: Number(jobs.done) || 0,
      failed: Number(jobs.failed) || 0,
      overbudget: Number(jobs.overbudget) || 0,
    },
    tokens: {
      extractionInput: Number(tokens.extractionInput) || 0,
      extractionOutput: Number(tokens.extractionOutput) || 0,
      synthesisInput: Number(tokens.synthesisInput) || 0,
      synthesisOutput: Number(tokens.synthesisOutput) || 0,
      escalated: Number(tokens.escalated) || 0,
      observations: Number(tokens.observations) || 0,
    },
  };
}

function parseModelRow(raw: unknown): OpsModelQualityRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const observationId = typeof r.observationId === "string" ? r.observationId : null;
  if (!observationId) return null;
  return {
    observationId,
    sessionId: String(r.sessionId ?? ""),
    segmentId: String(r.segmentId ?? ""),
    humanCorrected: Boolean(r.humanCorrected),
    overrides: (r.overrides as Record<string, unknown>) ?? {},
    model: String(r.model ?? "unknown"),
    createdAt: String(r.createdAt ?? ""),
  };
}

/** Session budget headroom: tokens remaining before the cost breaker would trip. */
export function sessionBudgetHeadroom(
  frameCount: number,
  extractionInputTokens: number,
): { budget: number; used: number; remaining: number; pctUsed: number } {
  const budget = sessionTokenBudget(frameCount);
  const used = extractionInputTokens;
  const remaining = Math.max(0, budget - used);
  const pctUsed = budget > 0 ? used / budget : 0;
  return { budget, used, remaining, pctUsed };
}

export async function getOpsHealth(): Promise<OpsHealthSummary | null> {
  return rpc<OpsHealthSummary>("ops_health_summary", {});
}

export async function getOpsDashboard(): Promise<OpsDashboardData> {
  const [health, fleetRaw, dailyRaw, qualityRaw, extractionRaw] = await Promise.all([
    rpc<OpsHealthSummary>("ops_health_summary", {}),
    rpc<unknown[]>("ops_fleet_sessions", { p_limit: 100 }),
    rpc<OpsDailySpend[]>("ops_daily_token_spend", { p_days: 14 }),
    rpc<unknown[]>("ops_model_quality_rows", { p_limit: 500 }),
    rpc<OpsExtractionModelStat[]>("ops_extraction_model_stats", {}),
  ]);

  const sessions = (fleetRaw ?? [])
    .map(parseFleetSession)
    .filter((s): s is OpsFleetSession => s !== null);

  const qualityRows = (qualityRaw ?? [])
    .map(parseModelRow)
    .filter((r): r is OpsModelQualityRow => r !== null);

  const modelQuality = aggregateModelQuality(qualityRows, extractionRaw ?? []);

  let extractionTokens = 0;
  let synthesisTokens = 0;
  let escalated = 0;
  let observations = 0;
  let headroomSessions = 0;

  for (const s of sessions) {
    extractionTokens += s.tokens.extractionInput + s.tokens.extractionOutput;
    synthesisTokens += s.tokens.synthesisInput + s.tokens.synthesisOutput;
    escalated += s.tokens.escalated;
    observations += s.tokens.observations;
    const { pctUsed } = sessionBudgetHeadroom(s.frameCount, s.tokens.extractionInput);
    if (pctUsed < 0.85 && s.status === "extracting") headroomSessions += 1;
  }

  const escalationRate = observations > 0 ? escalated / observations : 0;

  return {
    source: health ? "live" : "empty",
    health,
    sessions,
    dailySpend: dailyRaw ?? [],
    modelQuality,
    totals: {
      extractionTokens,
      synthesisTokens,
      escalationRate,
      budgetHeadroomSessions: headroomSessions,
    },
  };
}

/** Per-frame session budget constant for display. */
export function perFrameBudgetLabel(): number {
  return sessionInputTokensPerFrame();
}
