/**
 * Pure aggregation for human-correction analytics — no I/O, fully testable.
 */

import { RUBRIC_ITEM_KEYS, type RubricItemKey } from "../capture/types";
import type { OpsExtractionModelStat, OpsModelQualityRow } from "./types";

export type ModelCorrectionStat = {
  model: string;
  observations: number;
  humanCorrected: number;
  correctionRate: number;
  itemOverrides: Partial<Record<RubricItemKey, number>>;
  baselineOptOuts: number;
  manualScoreEdits: number;
};

export type ModelQualitySummary = {
  byModel: ModelCorrectionStat[];
  trend: { month: string; correctionRate: number; count: number }[];
  extraction: OpsExtractionModelStat[];
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Aggregate approved observation rows into per-model correction stats. */
export function aggregateModelQuality(
  rows: readonly OpsModelQualityRow[],
  extraction: readonly OpsExtractionModelStat[] = [],
): ModelQualitySummary {
  const byModel = new Map<string, ModelCorrectionStat>();

  for (const row of rows) {
    const model = row.model || "unknown";
    const entry =
      byModel.get(model) ??
      ({
        model,
        observations: 0,
        humanCorrected: 0,
        correctionRate: 0,
        itemOverrides: {},
        baselineOptOuts: 0,
        manualScoreEdits: 0,
      } satisfies ModelCorrectionStat);
    entry.observations += 1;
    if (row.humanCorrected) entry.humanCorrected += 1;

    const overrides = row.overrides ?? {};
    const itemsBySeq = (overrides.items ?? {}) as Record<string, unknown>;
    for (const seqItems of Object.values(itemsBySeq)) {
      if (!seqItems || typeof seqItems !== "object") continue;
      for (const key of Object.keys(seqItems as Record<string, unknown>)) {
        if (!RUBRIC_ITEM_KEYS.includes(key as RubricItemKey)) continue;
        const k = key as RubricItemKey;
        entry.itemOverrides[k] = (entry.itemOverrides[k] ?? 0) + 1;
      }
    }
    const baselineLenses = overrides.baselineLenses;
    if (Array.isArray(baselineLenses) && baselineLenses.length > 0) {
      entry.baselineOptOuts += baselineLenses.length;
    }
    const scores = overrides.scores;
    if (scores && typeof scores === "object" && Object.keys(scores as object).length > 0) {
      entry.manualScoreEdits += Object.keys(scores as object).length;
    }

    byModel.set(model, entry);
  }

  const models = [...byModel.values()].map((m) => ({
    ...m,
    correctionRate: m.observations > 0 ? m.humanCorrected / m.observations : 0,
  }));

  models.sort((a, b) => b.observations - a.observations);

  const trendMap = new Map<string, { corrected: number; total: number }>();
  for (const row of rows) {
    const month = row.createdAt?.slice(0, 7) ?? "unknown";
    const t = trendMap.get(month) ?? { corrected: 0, total: 0 };
    t.total += 1;
    if (row.humanCorrected) t.corrected += 1;
    trendMap.set(month, t);
  }
  const trend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { corrected, total }]) => ({
      month,
      correctionRate: total > 0 ? corrected / total : 0,
      count: total,
    }));

  return { byModel: models, trend, extraction: [...extraction] };
}

/** Escalation rate per extraction model. */
export function escalationRate(stat: OpsExtractionModelStat): number {
  const total = num(stat.total);
  return total > 0 ? num(stat.escalated) / total : 0;
}
