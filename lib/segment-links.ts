/**
 * Deep links from rankings into a street report card or the map instrument.
 *
 * Street permalinks are owned by unit-street-card (`/[locale]/street/[id]`).
 * When that route is not present in this worktree, fall back to the map.
 */

import { existsSync } from "node:fs";
import path from "node:path";

let streetRouteCached: boolean | null = null;

/** True when the street report-card route exists in this checkout. */
export function streetPagesAvailable(): boolean {
  if (streetRouteCached !== null) return streetRouteCached;
  streetRouteCached = existsSync(
    path.join(
      process.cwd(),
      "app",
      "[locale]",
      "street",
      "[segmentId]",
      "page.tsx",
    ),
  );
  return streetRouteCached;
}

/** Street report-card path. */
export function streetPath(segmentId: string): `/street/${string}` {
  return `/street/${segmentId}`;
}

/** Map deep-link with optional lens. */
export function mapSegmentPath(
  segmentId: string,
  layer: string = "overall",
): string {
  const q = new URLSearchParams({
    segment: segmentId,
    layer,
  });
  return `/map?${q.toString()}`;
}

/**
 * Prefer the street page when present; otherwise open the map focused on the
 * segment. Safe for server-rendered insight rows.
 */
export function insightSegmentHref(
  segmentId: string,
  layer: string = "overall",
): string {
  return streetPagesAvailable()
    ? streetPath(segmentId)
    : mapSegmentPath(segmentId, layer);
}
