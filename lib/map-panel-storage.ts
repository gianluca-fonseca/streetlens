/** Session-scoped MapPanel collapsed flag (visit memory, bgsd-0016). */
export const MAP_PANEL_COLLAPSED_KEY = "streetlens.mapPanel.collapsed";

export function readMapPanelCollapsed(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MAP_PANEL_COLLAPSED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeMapPanelCollapsed(collapsed: boolean): void {
  try {
    sessionStorage.setItem(MAP_PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* private mode / quota — degrade silently */
  }
}

/** First visit in a tab: compact on phones, full on desktop. */
export function defaultMapPanelCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}
