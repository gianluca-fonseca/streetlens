/**
 * The map's dimensional-view preference: is the extruded score relief on, and
 * has this visitor already been shown the establishing move?
 *
 * ── WHY A COOKIE, NOT localStorage ─────────────────────────────────────────
 * The control has to tell the truth on FIRST PAINT. `/map` renders the toggle
 * on the server, so the only store the server can consult is a cookie. With
 * localStorage the initial HTML would always render the default ("3D view" on)
 * and then correct itself after hydration, which is a visible lie for one frame
 * to exactly the visitor who turned it off. `lib/demo-flag.ts` already
 * establishes this pattern in the repo, and `lib/map-panel-storage.ts` is the
 * wrong neighbour to copy here: sessionStorage is per-tab, and this choice has
 * to survive a new tab and a reload, not just a navigation.
 *
 * Unlike the demo flag, this cookie is written CLIENT-side (see
 * `writeMapReliefPreference`) rather than through a server action. It is a view
 * preference, not a data-era switch: flipping it must be instant and must not
 * refetch the page, and nothing server-rendered depends on it beyond the
 * toggle's own initial state. It is therefore not httpOnly.
 *
 * ── ONE COOKIE, THREE STATES ───────────────────────────────────────────────
 * The two things that must persist (the on/off choice, and "has seen the
 * animation") collapse into a single value, because every reachable combination
 * is covered by three cases:
 *
 *   absent   first arrival        → relief ON,  animate
 *   "on"     kept it on           → relief ON,  no animation
 *   "off"    turned it off        → relief OFF, no animation
 *
 * The client writes "on" as soon as the map settles the dimensional view for
 * the first time, so the establishing move plays exactly once per browser. A
 * visitor who turns the relief off is written as "off" and therefore can never
 * be handed the fly-in again, which is the requirement that the off-choice
 * sticks across navigations and reloads.
 */

/** Cookie carrying the dimensional-view preference. Path `/`, SameSite=Lax. */
export const MAP_RELIEF_COOKIE = "sl_map_relief";

/** One year, matching the demo-data cookie: a preference, not a session. */
export const MAP_RELIEF_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const MAP_RELIEF_ON = "on";
export const MAP_RELIEF_OFF = "off";

/** What `/map` should do with the dimensional view on this request. */
export type MapReliefView = {
  /** Draw the extruded score relief and hold the pitched camera. */
  relief: boolean;
  /** Play the establishing move rather than opening on the settled frame.
   *  Reduced motion is NOT considered here: the server cannot know it, so the
   *  client ANDs this with its own `prefers-reduced-motion` check. */
  animate: boolean;
};

/**
 * Resolve the cookie into the view. Pure, so both directions are testable
 * without a request or a browser.
 *
 * Anything unrecognised (a stale value, a truncated cookie) is treated as a
 * first arrival: the relief is the default view, so an unreadable preference
 * degrades to the default rather than to "off".
 */
export function resolveMapReliefView(cookieValue?: string | null): MapReliefView {
  if (cookieValue === MAP_RELIEF_OFF) return { relief: false, animate: false };
  if (cookieValue === MAP_RELIEF_ON) return { relief: true, animate: false };
  return { relief: true, animate: true };
}

/**
 * Persist the choice from the client. Writing `on` is also what marks the
 * establishing move as seen, so the map calls this once the view has settled
 * on a first arrival as well as on every explicit toggle.
 */
export function writeMapReliefPreference(on: boolean): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; secure"
      : "";
  try {
    document.cookie =
      `${MAP_RELIEF_COOKIE}=${on ? MAP_RELIEF_ON : MAP_RELIEF_OFF}` +
      `; path=/; max-age=${MAP_RELIEF_COOKIE_MAX_AGE}; samesite=lax${secure}`;
  } catch {
    /* cookies blocked — the view still works, it just will not be remembered */
  }
}
