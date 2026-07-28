/**
 * The single switch that decides whether the mock/demo segment scores are shown
 * on the public site.
 *
 * Two layers, in precedence order:
 *
 *  1. **Runtime override (wins).** The `sl_demo_data` cookie, set by the demo
 *     switch in the map chrome. `"on"` publishes the pilot scores, `"off"` hides
 *     them. This is what makes the era flippable live, with no rebuild.
 *  2. **Build-time default.** `showDemoData()` reads
 *     `NEXT_PUBLIC_SHOW_DEMO_DATA` HERE and nowhere else, so the demo era is one
 *     flag, not a scatter of `process.env` reads. Default ON: unset (or anything
 *     other than the exact string "false") publishes the generated pilot scores.
 *     Set it to `"false"` to ship a build whose default is the real-data era.
 *
 * `resolveDemoData()` is the ONE place the two layers are combined. On the
 * server, `demoDataEnabled()` in `lib/demo-flag-server.ts` reads the cookie and
 * calls it; the resolved boolean is then threaded to client components through
 * `DemoDataProvider` and to the data layer as an explicit argument. Client code
 * must never read the env var or the cookie itself.
 *
 * The env var is read at call time (not a module-level constant) so a single
 * process can exercise both states in tests. In the Next bundle webpack still
 * inlines the `process.env.NEXT_PUBLIC_SHOW_DEMO_DATA` literal, so the
 * build-time default resolves in server and client bundles alike.
 */

/** Cookie carrying the runtime override. Path `/`, SameSite=Lax, one year. */
export const DEMO_DATA_COOKIE = "sl_demo_data";

/** One year, in seconds. Long enough that a demo link survives a stakeholder's week. */
export const DEMO_DATA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Cookie values. Anything else is treated as "no override". */
export const DEMO_DATA_ON = "on";
export const DEMO_DATA_OFF = "off";

/**
 * The BUILD-TIME default, and the only reader of the raw env var in the repo.
 * Callers that need the effective value want `resolveDemoData()` (or the server
 * accessor / the React provider), not this.
 */
export function showDemoData(): boolean {
  return process.env.NEXT_PUBLIC_SHOW_DEMO_DATA !== "false";
}

/**
 * The EFFECTIVE flag: the cookie override when present and well-formed,
 * otherwise the build-time default. Pure, so both directions are testable
 * without a request.
 */
export function resolveDemoData(cookieValue?: string | null): boolean {
  if (cookieValue === DEMO_DATA_ON) return true;
  if (cookieValue === DEMO_DATA_OFF) return false;
  return showDemoData();
}
