/** Localized permalink path for a street report card. */
export function streetPath(segmentId: string): `/street/${string}` {
  return `/street/${segmentId}`;
}

/** Map deep link that opens with the segment focused. */
export function mapSegmentPath(segmentId: string): `/map?segment=${string}` {
  return `/map?segment=${encodeURIComponent(segmentId)}`;
}

/** Absolute street URL for OG metadata and clipboard copy. */
export function absoluteStreetUrl(
  locale: string,
  segmentId: string,
  origin: string,
): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/${locale}${streetPath(segmentId)}`;
}
