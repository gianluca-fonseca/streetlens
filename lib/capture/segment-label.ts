/**
 * Human-readable segment labels for the review workbench.
 */

export type SegmentMeta = {
  id: string;
  name?: string;
  district?: string;
};

/** Primary line: street name when known, always with the segment id. */
export function formatSegmentTitle(meta: SegmentMeta | undefined, id: string): string {
  if (meta?.name) return `${meta.name} · ${id}`;
  return id;
}

/** Secondary district line, or null when unknown. */
export function formatSegmentDistrict(meta: SegmentMeta | undefined): string | null {
  if (!meta?.district) return null;
  return meta.district;
}

/** Caption for inspector / lightbox: name + district, falling back to id. */
export function formatSegmentCaption(meta: SegmentMeta | undefined, id: string | null): string {
  if (!id) return "";
  if (!meta?.name) return id;
  if (meta.district) return `${meta.name} · ${meta.district}`;
  return `${meta.name} · ${id}`;
}

/** Comma-separated street names for queue cards (up to `max`). */
export function summarizeStreetNames(
  metas: readonly SegmentMeta[],
  max = 3,
): string | null {
  const names = metas.map((m) => m.name).filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} +${rest}`;
  return shown.join(", ");
}
