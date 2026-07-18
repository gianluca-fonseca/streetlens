/**
 * Pure helpers for capture walk queue position (client + server safe).
 */

/** The walk immediately after `currentId` in the pending list, or null at the end. */
export function nextPendingSessionId(
  pendingIds: readonly string[],
  currentId: string,
): string | null {
  const idx = pendingIds.indexOf(currentId);
  if (idx === -1) return pendingIds[0] ?? null;
  return pendingIds[idx + 1] ?? null;
}

/** 1-based position of `currentId` within pending captures, or null if not pending. */
export function captureQueuePosition(
  pendingIds: readonly string[],
  currentId: string,
): { position: number; total: number; remaining: number } | null {
  const idx = pendingIds.indexOf(currentId);
  if (idx === -1) return null;
  return {
    position: idx + 1,
    total: pendingIds.length,
    remaining: pendingIds.length - idx - 1,
  };
}
