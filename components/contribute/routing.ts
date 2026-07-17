/**
 * Client entry point for street-following trace routing.
 *
 * The routing algorithm itself lives in the pure `routing-core.mjs` (shared
 * verbatim with the node-level routing test). This wrapper adds the browser
 * concern the core deliberately omits: fetch the committed routing network from
 * /api/routing-network exactly once, memoize the built router, and expose an
 * eager preload so the graph is warm before the first routed span.
 */

import { createRouter } from "./routing-core.mjs";
import type { Router, RoutingNetwork } from "./routing-core.mjs";

export { SNAP_THRESHOLD_M } from "./routing-core.mjs";
export type {
  LngLat,
  Router,
  RouteResult,
  RoutingNetwork,
  RoutingProps,
} from "./routing-core.mjs";

const NETWORK_URL = "/api/routing-network";

let routerPromise: Promise<Router> | null = null;

async function loadRouter(): Promise<Router> {
  const res = await fetch(NETWORK_URL);
  if (!res.ok) throw new Error(`routing network fetch failed: ${res.status}`);
  const network = (await res.json()) as RoutingNetwork;
  return createRouter(network);
}

/**
 * Get the shared client router, building it (and fetching the network) on first
 * call. Subsequent calls reuse the same promise. A failed load is not cached,
 * so a later attempt can retry.
 */
export function getRouter(): Promise<Router> {
  if (!routerPromise) {
    routerPromise = loadRouter().catch((err) => {
      routerPromise = null;
      throw err;
    });
  }
  return routerPromise;
}

/** Kick off the network fetch ahead of the first routed span (fire-and-forget). */
export function preloadRouter(): void {
  void getRouter().catch(() => {
    /* preload is best-effort; the real call surfaces errors */
  });
}
