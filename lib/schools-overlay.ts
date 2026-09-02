/**
 * Whether the schools overlay is drawn, remembered across visits.
 *
 * localStorage rather than the relief's cookie: the relief toggle is rendered on
 * the SERVER (it sits in `/map`'s HTML), so only a cookie could make its first
 * paint truthful. This switch is rendered inside AuditMap, which is a client
 * component that paints after hydration either way, so there is no first-paint
 * lie to avoid and no reason to put another cookie on every request.
 *
 * The default is ON. The overlay is the point of the school-safety view, and a
 * first-time visitor arriving at a map with the schools hidden would have to
 * discover the switch before the map could make its argument.
 */

export const SCHOOLS_OVERLAY_KEY = "streetlens.map.schools";

/** `null` when the visitor has expressed no preference yet. */
export function readSchoolsOverlay(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCHOOLS_OVERLAY_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeSchoolsOverlay(on: boolean): void {
  try {
    localStorage.setItem(SCHOOLS_OVERLAY_KEY, on ? "1" : "0");
  } catch {
    /* private mode / quota — the overlay still works, it just is not remembered */
  }
}
