"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { getRouter, preloadRouter } from "@/components/contribute/routing";
import type { LngLat } from "@/components/contribute/routing";

/**
 * Drawing the route a video was walked along, on a map, following streets.
 *
 * WHAT THIS REUSES. The routing itself, untouched: `getRouter` / `preloadRouter`
 * from `components/contribute/routing`. That module is pure in the way that
 * matters here. It fetches a network, memoizes a router, and answers
 * `routeBetween(from, to)`. It knows nothing about who is asking, so there is
 * nothing to fork. The MapLibre layer work below is also lifted, deliberately
 * and near-verbatim, from `components/contribute/useContribute.ts`: the
 * source/layer setup, the solid-vs-dashed split, the paint values, the
 * shared-joint dedupe, and the monotonic run id that stops a slow route from
 * landing on top of a newer edit. That implementation is proven in the manual
 * flow and reinventing its geometry handling would only invent new bugs.
 *
 * WHAT THIS DOES NOT REUSE, AND WHY. `useContribute` itself. Not because of
 * taste: three of its behaviours are actively wrong for this flow.
 *
 *  1. `startTrace()` calls `commitDots([])`. Arming the tool WIPES the drawn
 *     dots. Here the video already exists and the contributor is reconstructing
 *     a walk from memory, so re-arming after a pause has to be free. Arming and
 *     content are independent in this hook: `setArmed(true)` never touches a dot.
 *  2. A double-click there sets `mode = "add"`, and the draw-handler effect is
 *     gated on `mode === "trace"`, so finishing tears the handlers down and
 *     drops the user into a state this flow has no meaning for. There is no
 *     terminal mode here. A double-click finishes, which means it disarms, and
 *     disarming is reversible with a click.
 *  3. `submit()` is hard-wired to `POST /api/submissions`. This flow posts a
 *     video somewhere else entirely. Along with `picked` and the segment
 *     selection it carries, that is a whole state machine for a screen that is
 *     not ours.
 *
 * So this hook keeps the engine and drops the machine. It owns exactly one bit
 * of mode (`armed`) and otherwise just holds geometry, which the caller reads
 * out of `pathCoordinates` whenever it likes, armed or not.
 *
 * COORDINATE ORDER. Everything in this file is `[lng, lat]`, because MapLibre
 * and the router both are, and a `Vertex` here is that tuple. `{ lat, lng }`
 * objects (`LatLng` in `lib/capture/route.ts`) do not appear anywhere below.
 * The conversion happens at exactly ONE boundary, in `TraceMap`, on the way out
 * to `onPathChange`. Keeping the flip at a single named edge is the only cheap
 * defence against the classic version of this bug, which is silent: swap the
 * pair and Escazú relocates to the Indian Ocean, with no error to read.
 *
 * DISARM VS UNMOUNT. Disarming detaches the click handlers and restores
 * double-click zoom and the cursor, but LEAVES the layers and their data on the
 * map. That is the point of finishing: the drawn route stays visible and stays
 * readable. Only unmount removes the layers and sources, because only then is
 * there nobody left to show them to.
 */

/** A map coordinate, `[lng, lat]`, matching MapLibre and the router. */
export type Vertex = [number, number];

// Solid = routed spans; dashed = "could not follow streets here" spans.
const LINE_SRC = "trace-line";
const FALLBACK_SRC = "trace-fallback";
const VERT_SRC = "trace-verts";
const LINE_LYR = "trace-line-layer";
const FALLBACK_LYR = "trace-fallback-layer";
const VERT_LYR = "trace-verts-layer";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

type LineFC = GeoJSON.FeatureCollection<GeoJSON.LineString>;
type PointFC = GeoJSON.FeatureCollection<GeoJSON.Point>;

function lineFC(spans: Vertex[][]): LineFC {
  return {
    type: "FeatureCollection",
    features: spans
      .filter((s) => s.length >= 2)
      .map((coordinates) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      })),
  };
}

function pointFC(dots: Vertex[]): PointFC {
  return {
    type: "FeatureCollection",
    features: dots.map((c) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: c },
    })),
  };
}

function ensureDrawLayers(map: maplibregl.Map) {
  if (!map.getSource(LINE_SRC)) {
    map.addSource(LINE_SRC, { type: "geojson", data: EMPTY_FC as never });
  }
  if (!map.getSource(FALLBACK_SRC)) {
    map.addSource(FALLBACK_SRC, { type: "geojson", data: EMPTY_FC as never });
  }
  if (!map.getSource(VERT_SRC)) {
    map.addSource(VERT_SRC, { type: "geojson", data: EMPTY_FC as never });
  }
  // Solid routed line = the confident street-following path. Paint values are
  // the manual flow's, kept identical on purpose: a traced route should look
  // like a traced route everywhere in the product.
  if (!map.getLayer(LINE_LYR)) {
    map.addLayer({
      id: LINE_LYR,
      type: "line",
      source: LINE_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#E07A3F", "line-width": 3.5 },
    });
  }
  // Dashed fallback = "could not follow streets here". The dash is the whole
  // message: this span is a straight guess, not a street we found.
  if (!map.getLayer(FALLBACK_LYR)) {
    map.addLayer({
      id: FALLBACK_LYR,
      type: "line",
      source: FALLBACK_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#E07A3F",
        "line-width": 3.5,
        "line-dasharray": [2, 1.4],
        "line-opacity": 0.85,
      },
    });
  }
  // The contributor's own dots sit on top of both lines.
  if (!map.getLayer(VERT_LYR)) {
    map.addLayer({
      id: VERT_LYR,
      type: "circle",
      source: VERT_SRC,
      paint: {
        "circle-radius": 5,
        "circle-color": "#E07A3F",
        "circle-stroke-color": "#FBFAF6",
        "circle-stroke-width": 2,
      },
    });
  }
}

/**
 * Tear the layers and sources back out.
 *
 * Every call is guarded, because unmount ordering is not something this hook
 * gets to be certain about: if the owning component's `map.remove()` has already
 * run, these lookups are being made against a dead map.
 */
function removeDrawLayers(map: maplibregl.Map) {
  for (const id of [VERT_LYR, FALLBACK_LYR, LINE_LYR]) {
    try {
      if (map.getLayer(id)) map.removeLayer(id);
    } catch {
      /* map already torn down */
    }
  }
  for (const id of [VERT_SRC, FALLBACK_SRC, LINE_SRC]) {
    try {
      if (map.getSource(id)) map.removeSource(id);
    } catch {
      /* map already torn down */
    }
  }
}

function setVertData(map: maplibregl.Map, dots: Vertex[]) {
  const src = map.getSource(VERT_SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(pointFC(dots));
}

function setLineData(map: maplibregl.Map, solid: Vertex[][], dashed: Vertex[][]) {
  const solidSrc = map.getSource(LINE_SRC) as maplibregl.GeoJSONSource | undefined;
  const dashSrc = map.getSource(FALLBACK_SRC) as maplibregl.GeoJSONSource | undefined;
  if (solidSrc) solidSrc.setData(lineFC(solid));
  if (dashSrc) dashSrc.setData(lineFC(dashed));
}

/** Concatenate a routed span onto the flattened path, dropping a shared joint. */
function appendDedupe(flat: Vertex[], span: Vertex[]): Vertex[] {
  const out = flat.slice();
  for (const c of span) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
  }
  return out;
}

export type TraceApi = {
  /** The raw dots the contributor clicked, `[lng, lat]`. */
  dots: Vertex[];
  /** The rendered polyline: routed spans concatenated, shared joints deduped. */
  pathCoordinates: Vertex[];
  /** "Follow streets" on (default) vs. a free straight-line trace. */
  followStreets: boolean;
  /** True while a routed recompute is in flight. */
  routing: boolean;
  /** True when at least one span fell back to a straight connector. */
  hasFallback: boolean;
  /** True while map clicks drop dots. */
  armed: boolean;
  setArmed: (on: boolean) => void;
  toggleFollowStreets: () => void;
  undo: () => void;
  clear: () => void;
};

export function useTrace(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
): TraceApi {
  const [dots, setDots] = useState<Vertex[]>([]);
  const [pathCoordinates, setPathCoordinates] = useState<Vertex[]>([]);
  const [followStreets, setFollowStreets] = useState(true);
  const [routing, setRouting] = useState(false);
  const [hasFallback, setHasFallback] = useState(false);
  const [armed, setArmedState] = useState(false);

  const dotsRef = useRef<Vertex[]>(dots);
  const followStreetsRef = useRef(followStreets);
  // Monotonic id so a slow routed recompute cannot overwrite a newer one. Every
  // recompute claims the next id; a resolution whose id is stale just returns.
  const routeRunRef = useRef(0);

  useEffect(() => {
    followStreetsRef.current = followStreets;
  }, [followStreets]);

  // Recompute the rendered path for a set of dots plus a follow-streets choice.
  // Runs from user actions (a new dot, undo, clear, toggling the mode) and from
  // the map becoming ready, never speculatively from an effect body. Free trace
  // is synchronous straight lines. Follow-streets routes each span through the
  // network asynchronously, guarded against stale runs.
  const recompute = useCallback(
    (nextDots: Vertex[], follow: boolean) => {
      const map = mapRef.current;
      const runId = (routeRunRef.current += 1);
      if (map) {
        ensureDrawLayers(map);
        setVertData(map, nextDots);
      }

      if (nextDots.length < 2) {
        if (map) setLineData(map, [], []);
        setPathCoordinates([]);
        setHasFallback(false);
        setRouting(false);
        return;
      }

      if (!follow) {
        if (map) setLineData(map, [nextDots], []);
        setPathCoordinates(nextDots);
        setHasFallback(false);
        setRouting(false);
        return;
      }

      setRouting(true);
      getRouter()
        .then((router) => {
          if (routeRunRef.current !== runId) return;
          const solid: Vertex[][] = [];
          const dashed: Vertex[][] = [];
          let flat: Vertex[] = [];
          let fallback = false;
          for (let i = 1; i < nextDots.length; i += 1) {
            const r = router.routeBetween(nextDots[i - 1] as LngLat, nextDots[i] as LngLat);
            const span = r.coords as Vertex[];
            if (r.ok) solid.push(span);
            else {
              dashed.push(span);
              fallback = true;
            }
            flat = appendDedupe(flat, span);
          }
          const m = mapRef.current;
          if (m) setLineData(m, solid, dashed);
          setPathCoordinates(flat);
          setHasFallback(fallback);
          setRouting(false);
        })
        .catch(() => {
          if (routeRunRef.current !== runId) return;
          // The routing network is unavailable. Draw the dashed straight
          // fallback: the contributor is never blocked, and is never shown a
          // line that pretends to be routed when nothing routed it.
          const m = mapRef.current;
          if (m) setLineData(m, [], [nextDots]);
          setPathCoordinates(nextDots);
          setHasFallback(true);
          setRouting(false);
        });
    },
    [mapRef],
  );

  const commitDots = useCallback(
    (next: Vertex[]) => {
      dotsRef.current = next;
      setDots(next);
      recompute(next, followStreetsRef.current);
    },
    [recompute],
  );

  // The map can finish loading after dots already exist (re-mounting a step, or
  // a slow style). Paint whatever is already held the moment there is somewhere
  // to paint it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    ensureDrawLayers(map);
    recompute(dotsRef.current, followStreetsRef.current);
  }, [mapReady, mapRef, recompute]);

  // Draw handlers live only while armed. Note what is NOT here: nothing clears a
  // dot on the way in or out. Arming is a handler subscription and nothing more.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !armed) return;

    ensureDrawLayers(map);
    map.doubleClickZoom.disable();
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";

    const onClick = (e: maplibregl.MapMouseEvent) => {
      commitDots([...dotsRef.current, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      // The double-click already fired a single click, which dropped a duplicate
      // dot on the same spot. Take it back off before finishing, or the last
      // span of every finished route is a zero-length stub.
      const cur = dotsRef.current;
      const trimmed = cur.length > 1 ? cur.slice(0, -1) : cur;
      commitDots(trimmed);
      // Finish only if there is a route to finish. A double-click on an empty
      // map is a misclick, and disarming there would just be rude.
      if (trimmed.length >= 2) setArmedState(false);
    };

    map.on("click", onClick);
    map.on("dblclick", onDbl);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      map.doubleClickZoom.enable();
      canvas.style.cursor = "";
    };
  }, [armed, mapReady, mapRef, commitDots]);

  // Unmount only. The drawn route outlives disarming; it does not outlive the
  // component. Registered before the owner's own map effect so this runs first,
  // but `removeDrawLayers` is guarded anyway rather than trusting that.
  useEffect(() => {
    return () => {
      routeRunRef.current += 1;
      // Read at cleanup time, deliberately. The lint rule wants this copied into
      // a variable when the effect runs, which would capture `null`: this effect
      // is registered before the owner ever builds the map, so `mapRef.current`
      // is only populated later. This is a map instance, not a React-rendered
      // node, and reading it late is the entire point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const map = mapRef.current;
      if (map) removeDrawLayers(map);
    };
  }, [mapRef]);

  const setArmed = useCallback((on: boolean) => {
    // Warm the routing network on the way in, so the first routed span lands
    // instantly instead of after a network fetch the contributor did not ask
    // for. Best-effort by design: `preloadRouter` swallows its own failure and
    // the real `getRouter` call in `recompute` surfaces anything real.
    if (on) preloadRouter();
    setArmedState(on);
  }, []);

  const toggleFollowStreets = useCallback(() => {
    const next = !followStreetsRef.current;
    followStreetsRef.current = next;
    setFollowStreets(next);
    recompute(dotsRef.current, next);
  }, [recompute]);

  const undo = useCallback(() => {
    commitDots(dotsRef.current.slice(0, -1));
  }, [commitDots]);

  const clear = useCallback(() => {
    commitDots([]);
  }, [commitDots]);

  return {
    dots,
    pathCoordinates,
    followStreets,
    routing,
    hasFallback,
    armed,
    setArmed,
    toggleFollowStreets,
    undo,
    clear,
  };
}
