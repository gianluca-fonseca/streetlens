"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { Submission } from "@/lib/schemas";

/**
 * State machine + map-drawing engine for the contribution flow.
 *
 * Owns: the mode, the traced polyline (vertices + live draw layers), the
 * picked segment for corrections, and the submit lifecycle. AuditMap calls
 * this once and consults `modeRef` / `pickSegment` to gate its own segment
 * clicks; all draw handlers attach/detach here so u1's map internals stay
 * untouched.
 */

export type ContributeMode =
  | "idle"
  | "choose"
  | "trace"
  | "select"
  | "add"
  | "update";

export type SubmitState = "idle" | "submitting" | "success";
export type PickedSegment = { id: string; name: string };
export type Vertex = [number, number];

const LINE_SRC = "contribute-line";
const VERT_SRC = "contribute-verts";
const LINE_LYR = "contribute-line-layer";
const VERT_LYR = "contribute-verts-layer";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

function ensureDrawLayers(map: maplibregl.Map) {
  if (!map.getSource(LINE_SRC)) {
    map.addSource(LINE_SRC, { type: "geojson", data: EMPTY_FC as never });
  }
  if (!map.getSource(VERT_SRC)) {
    map.addSource(VERT_SRC, { type: "geojson", data: EMPTY_FC as never });
  }
  if (!map.getLayer(LINE_LYR)) {
    map.addLayer({
      id: LINE_LYR,
      type: "line",
      source: LINE_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      // Terracotta = the sparing interactive accent; dashed reads as "draft".
      paint: {
        "line-color": "#E07A3F",
        "line-width": 3.5,
        "line-dasharray": [2, 1.4],
      },
    });
  }
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

function setDrawData(map: maplibregl.Map, verts: Vertex[]) {
  const lineSrc = map.getSource(LINE_SRC) as maplibregl.GeoJSONSource | undefined;
  const vertSrc = map.getSource(VERT_SRC) as maplibregl.GeoJSONSource | undefined;
  if (lineSrc) {
    lineSrc.setData(
      verts.length >= 2
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: verts },
              },
            ],
          }
        : (EMPTY_FC as never),
    );
  }
  if (vertSrc) {
    vertSrc.setData({
      type: "FeatureCollection",
      features: verts.map((c) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: c },
      })),
    });
  }
}

export type ContributeApi = {
  mode: ContributeMode;
  modeRef: React.MutableRefObject<ContributeMode>;
  verts: Vertex[];
  picked: PickedSegment | null;
  submitState: SubmitState;
  errorKey: string | null;
  open: () => void;
  cancel: () => void;
  startTrace: () => void;
  startSelect: () => void;
  undo: () => void;
  clear: () => void;
  finishTrace: () => void;
  pickSegment: (segment: PickedSegment) => void;
  backToChoose: () => void;
  submit: (submission: Submission) => Promise<boolean>;
  reset: () => void;
};

export function useContribute(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
): ContributeApi {
  const [mode, setMode] = useState<ContributeMode>("idle");
  const [verts, setVerts] = useState<Vertex[]>([]);
  const [picked, setPicked] = useState<PickedSegment | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const modeRef = useRef<ContributeMode>(mode);
  const vertsRef = useRef<Vertex[]>(verts);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const commitVerts = useCallback((next: Vertex[]) => {
    vertsRef.current = next;
    setVerts(next);
    const map = mapRef.current;
    if (map) setDrawData(map, next);
  }, [mapRef]);

  // Attach draw handlers only while tracing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== "trace") return;

    ensureDrawLayers(map);
    map.doubleClickZoom.disable();
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";

    const onClick = (e: maplibregl.MapMouseEvent) => {
      commitVerts([...vertsRef.current, [e.lngLat.lng, e.lngLat.lat]]);
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      // The double-click also fired a single click that dropped a duplicate
      // point; drop it back off, then finish if the path is still valid.
      const cur = vertsRef.current;
      const trimmed = cur.length > 1 ? cur.slice(0, -1) : cur;
      commitVerts(trimmed);
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
  }, [mode, mapReady, mapRef, commitVerts]);

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
    vertsRef.current = [];
    setVerts([]);
    const map = mapRef.current;
    if (map) setDrawData(map, []);
  }, [mapRef]);

  const open = useCallback(() => {
    setErrorKey(null);
    setSubmitState("idle");
    setMode("choose");
  }, []);

  const cancel = useCallback(() => reset(), [reset]);

  const startTrace = useCallback(() => {
    setErrorKey(null);
    commitVerts([]);
    setMode("trace");
  }, [commitVerts]);

  const startSelect = useCallback(() => {
    setErrorKey(null);
    setPicked(null);
    setMode("select");
  }, []);

  const undo = useCallback(() => {
    commitVerts(vertsRef.current.slice(0, -1));
  }, [commitVerts]);

  const clear = useCallback(() => {
    commitVerts([]);
  }, [commitVerts]);

  const finishTrace = useCallback(() => {
    if (vertsRef.current.length >= 2) setMode("add");
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
          if (map) setDrawData(map, []);
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
    verts,
    picked,
    submitState,
    errorKey,
    open,
    cancel,
    startTrace,
    startSelect,
    undo,
    clear,
    finishTrace,
    pickSegment,
    backToChoose,
    submit,
    reset,
  };
}
