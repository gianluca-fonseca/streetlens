import type { FeatureCollection, LineString } from "geojson";

export type LngLat = [number, number];

/** Properties carried by each routing-network way (kept lean at build time). */
export type RoutingProps = { highway: string; osm_way_id: number };

export type RoutingNetwork = FeatureCollection<LineString, RoutingProps>;

/**
 * Result of routing between two dots.
 *  - `ok: true`  → `coords` is the routed polyline that follows streets.
 *  - `ok: false` → routing failed (a dot was off-network, or the dots sit on
 *    disconnected pieces of the graph); `coords` is the straight [from, to]
 *    connector the caller should render dashed with a warning.
 */
export type RouteResult = { coords: LngLat[]; ok: boolean };

export type Router = {
  /** Route from one dot to the next through the street network. */
  routeBetween: (from: LngLat, to: LngLat) => RouteResult;
  /** Distinct network vertices — exposed for tests / diagnostics. */
  vertexCount: number;
};

/** A dot farther than this (meters) from any network vertex is off-network. */
export declare const SNAP_THRESHOLD_M: number;

/** Build a router from an in-memory routing network. Pure and synchronous. */
export declare function createRouter(network: RoutingNetwork): Router;
