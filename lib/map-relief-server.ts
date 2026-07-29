import { cookies } from "next/headers";
import { MAP_RELIEF_COOKIE, resolveMapReliefView } from "./map-relief";
import type { MapReliefView } from "./map-relief";

/**
 * The dimensional-view state for the current request.
 *
 * Server-only by construction (`cookies()` from `next/headers`), mirroring
 * `lib/demo-flag-server.ts`. `/map` already reads a cookie for the demo era, so
 * this adds no rendering cost: the route is dynamic either way. Resolving here
 * rather than in the client is the whole point — it is what lets the "3D view"
 * control render its real state in the initial HTML instead of flashing the
 * default and correcting after hydration.
 */
export async function mapReliefView(): Promise<MapReliefView> {
  const store = await cookies();
  return resolveMapReliefView(store.get(MAP_RELIEF_COOKIE)?.value);
}
