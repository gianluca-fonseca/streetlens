"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Submission } from "@/lib/schemas";
import { getRouter, preloadRouter } from "@/components/contribute/routing";
import type { LngLat } from "@/components/contribute/routing";

/**
 * State machine + map-drawing engine for the contribution flow.
 *
 * Owns: the mode, the user's trace DOTS decoupled from the rendered polyline,
 * the street-following routing between them, the picked segment for
 * corrections, and the submit lifecycle. AuditMap calls this once and consults
 * `modeRef` / `pickSegment` to gate its own segment clicks; all draw handlers
 * attach/detach here so u1's map internals stay untouched.
 *
 * Trace geometry model (u5): the circles are the raw USER DOTS; the terracotta
 * line is the ROUTED path between them. With "Follow streets" on (default) each
 * span is routed through the street network (solid) or, when a dot is
 * off-network / disconnected, drawn as a dashed straight fallback. Free trace
 * connects the dots with straight solid lines for genuinely unmapped paths.
 */

export type ContributeMode =
  | "idle"
  | "choose"
  | "trace"
  | "select"
  | "add"
  | "update";

export type SubmitState = "idle" | "submitting" | "success";
export type Vertex = [number, number];
export type PickedSegment = {
  id: string;
  name: string;
  /** The selected segment's geometry, for the "View my trace" fly-to. */
  coordinates: Vertex[];
};

// Solid = routed / free-trace spans; dashed = "couldn't follow streets" spans.
const LINE_SRC = "contribute-line";
const FALLBACK_SRC = "contribute-fallback";
const VERT_SRC = "contribute-verts";
const LINE_LYR = "contribute-line-layer";
const FALLBACK_LYR = "contribute-fallback-layer";
const VERT_LYR = "contribute-verts-layer";

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
  // Solid routed line = the confident street-following path.
  if (!map.getLayer(LINE_LYR)) {
    map.addLayer({
      id: LINE_LYR,
      type: "line",
      source: LINE_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      // Terracotta = the sparing interactive accent.
      paint: { "line-color": "#E07A3F", "line-width": 3.5 },
    });
  }
  // Dashed fallback = "couldn't follow streets here" (draft / uncertain).
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
  // User dots sit on top of both lines.
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

function setVertData(map: maplibregl.Map, dots: Vertex[]) {
  const src = map.getSource(VERT_SRC) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(pointFC(dots));
}

function setLineData(
  map: maplibregl.Map,
  solid: Vertex[][],
  dashed: Vertex[][],
) {
  const solidSrc = map.getSource(LINE_SRC) as maplibregl.GeoJSONSource | undefined;
  const dashSrc = map.getSource(FALLBACK_SRC) as
    | maplibregl.GeoJSONSource
    | undefined;
  if (solidSrc) solidSrc.setData(lineFC(solid));
  if (dashSrc) dashSrc.setData(lineFC(dashed));
}

function clearDraw(map: maplibregl.Map) {
  setVertData(map, []);
  setLineData(map, [], []);
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

export type ContributeApi = {
  mode: ContributeMode;
  modeRef: React.MutableRefObject<ContributeMode>;
  /** The raw user dots (circles) the contributor clicked. */
  dots: Vertex[];
  /** The routed polyline submitted / flown to (follows streets when on). */
  pathCoordinates: Vertex[];
  /** "Follow streets" on (default) vs. free straight-line trace. */
  followStreets: boolean;
  /** True while a routed recompute is in flight. */
  routing: boolean;
  /** True when at least one span fell back to a dashed straight connector. */
  hasFallback: boolean;
  picked: PickedSegment | null;
  submitState: SubmitState;
  errorKey: string | null;
  open: () => void;
  cancel: () => void;
  startTrace: () => void;
  startSelect: () => void;
  toggleFollowStreets: () => void;
  undo: () => void;
  clear: () => void;
  finishTrace: () => void;
  pickSegment: (segment: PickedSegment) => void;
  backToChoose: () => void;
  /** Fly the camera to fit the given geometry, left of the right-docked form. */
  flyToCoords: (coords: Vertex[]) => void;
  submit: (submission: Submission) => Promise<boolean>;
  reset: () => void;
};

export function useContribute(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
): ContributeApi {
  const [mode, setMode] = useState<ContributeMode>("idle");
  const [dots, setDots] = useState<Vertex[]>([]);
  const [pathCoordinates, setPathCoordinates] = useState<Vertex[]>([]);
  const [followStreets, setFollowStreets] = useState(true);
  const [routing, setRouting] = useState(false);
  const [hasFallback, setHasFallback] = useState(false);
  const [picked, setPicked] = useState<PickedSegment | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const modeRef = useRef<ContributeMode>(mode);
  const dotsRef = useRef<Vertex[]>(dots);
  const followStreetsRef = useRef(followStreets);
  // Monotonic id so a slow routed recompute can't overwrite a newer one.
  const routeRunRef = useRef(0);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    followStreetsRef.current = followStreets;
  }, [followStreets]);

  // Recompute the rendered path for a set of dots + follow-streets choice. Runs
  // from user actions (a new dot, undo/clear, toggling the mode), never from an
  // effect body. Free trace is synchronous straight lines; follow-streets routes
  // each span through the network asynchronously, guarded against stale runs.
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
            const r = router.routeBetween(
              nextDots[i - 1] as LngLat,
              nextDots[i] as LngLat,
            );
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
          // Routing network unavailable: draw a dashed straight fallback so the
          // contributor is never blocked and never shown a fake routed line.
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

  // Attach draw handlers only while tracing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== "trace") return;

    ensureDrawLayers(map);
    map.doubleClickZoom.disable();
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";

    const onClick = (e: maplibregl.MapMouseEvent) => {
      commitDots([...dotsRef.current, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      // The double-click also fired a single click that dropped a duplicate
      // dot; drop it back off, then finish if the path is still valid.
      const cur = dotsRef.current;
      const trimmed = cur.length > 1 ? cur.slice(0, -1) : cur;
      commitDots(trimmed);
      if (trimmed.length >= 2) setMode("add");
    };

    map.on("click", onClick);
    map.on("dblclick", onDbl);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      map.doubleClickZoom.enable();
      canvas.style.cursor = "";
    };
  }, [mode, mapReady, mapRef, commitDots]);

  // Hint cursor while selecting a segment to correct.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== "select") return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "pointer";
    return () => {
      canvas.style.cursor = "";
    };
  }, [mode, mapReady, mapRef]);

  const reset = useCallback(() => {
    setMode("idle");
    setPicked(null);
    setSubmitState("idle");
    setErrorKey(null);
    setFollowStreets(true);
    followStreetsRef.current = true;
    routeRunRef.current += 1;
    setPathCoordinates([]);
    setHasFallback(false);
    setRouting(false);
    dotsRef.current = [];
    setDots([]);
    const map = mapRef.current;
    if (map) clearDraw(map);
  }, [mapRef]);

  const open = useCallback(() => {
    setErrorKey(null);
    setSubmitState("idle");
    setMode("choose");
  }, []);

  const cancel = useCallback(() => reset(), [reset]);

  const startTrace = useCallback(() => {
    setErrorKey(null);
    commitDots([]);
    // Warm the routing network so the first routed span is instant.
    preloadRouter();
    setMode("trace");
  }, [commitDots]);

  const startSelect = useCallback(() => {
    setErrorKey(null);
    setPicked(null);
    setMode("select");
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

  const finishTrace = useCallback(() => {
    if (dotsRef.current.length >= 2) setMode("add");
  }, []);

  const pickSegment = useCallback((segment: PickedSegment) => {
    setPicked(segment);
    setErrorKey(null);
    setMode("update");
  }, []);

  const backToChoose = useCallback(() => {
    setErrorKey(null);
    setMode("choose");
  }, []);

  const flyToCoords = useCallback(
    (coords: Vertex[]) => {
      const map = mapRef.current;
      if (!map || coords.length === 0) return;
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      // Extra right padding (~form width) so the geometry lands visibly LEFT
      // of the right-docked form; matches the u1 segment-select fly-to feel.
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: 80, left: 120, right: 420 },
        maxZoom: 16.5,
        duration: 1100,
        essential: true,
      });
    },
    [mapRef],
  );

  const submit = useCallback(
    async (submission: Submission): Promise<boolean> => {
      setSubmitState("submitting");
      setErrorKey(null);
      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(submission),
        });
        if (res.ok) {
          setSubmitState("success");
          const map = mapRef.current;
          if (map) clearDraw(map);
          return true;
        }
        if (res.status === 429) setErrorKey("rateLimited");
        else if (res.status === 400) setErrorKey("invalid");
        else setErrorKey("generic");
        setSubmitState("idle");
        return false;
      } catch {
        setErrorKey("network");
        setSubmitState("idle");
        return false;
      }
    },
    [mapRef],
  );

  return {
    mode,
    modeRef,
    dots,
    pathCoordinates,
    followStreets,
    routing,
    hasFallback,
    picked,
    submitState,
    errorKey,
    open,
    cancel,
    startTrace,
    startSelect,
    toggleFollowStreets,
    undo,
    clear,
    finishTrace,
    pickSegment,
    backToChoose,
    flyToCoords,
    submit,
    reset,
  };
}
