/**
 * Review workbench draft persistence (localStorage).
 *
 * Corrections, reason, and segment selection survive refresh and back-navigation.
 * Cleared on a successful approve/reject so stale drafts never re-open on a
 * decided session.
 */

import type { ReviewCorrections } from "./review-overrides";

export type ReviewDraft = {
  corrections: ReviewCorrections;
  reason: string;
  selected: string[];
};

const PREFIX = "streetlens-review-draft:";

export function reviewDraftKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function loadReviewDraft(sessionId: string): ReviewDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(reviewDraftKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReviewDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.selected)) return null;
    if (typeof parsed.reason !== "string") return null;
    if (!parsed.corrections || typeof parsed.corrections !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveReviewDraft(sessionId: string, draft: ReviewDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(reviewDraftKey(sessionId), JSON.stringify(draft));
  } catch {
    // Quota exceeded or private mode — non-fatal.
  }
}

export function clearReviewDraft(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(reviewDraftKey(sessionId));
  } catch {
    // ignore
  }
}
