/**
 * Honest, stranger-answerable condition tiers, one per score layer.
 *
 * These feed the contribution forms. The frozen submission schema
 * (lib/schemas.ts) carries no per-layer numeric fields — a submission is a
 * human-reviewed proposal — so the selected tiers are compiled into the
 * accepted `note` / `reason` text as a readable condition report rather than
 * invented 0-100 numbers. Keys map to the `contribute.conditions.*` messages.
 */

export const CONDITION_KEYS = [
  "surface",
  "accessibility",
  "drainage",
  "shade",
] as const;

export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** Ordered option keys per condition (map to messages `...options.<key>`). */
export const CONDITION_OPTIONS: Record<ConditionKey, readonly string[]> = {
  surface: ["good", "fair", "poor", "none"],
  accessibility: ["good", "partial", "poor", "unsure"],
  drainage: ["good", "fair", "poor", "unsure"],
  shade: ["good", "fair", "poor", "unsure"],
} as const;

/** A tier that carries no signal (unanswered) — excluded from the report. */
export function isMeaningfulTier(value: string): boolean {
  return value.length > 0 && value !== "unsure";
}

export type ConditionState = Partial<Record<ConditionKey, string>>;
