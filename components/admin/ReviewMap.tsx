"use client";

/**
 * The walk on a map (u2).
 *
 * The review page's spatial conscience: the session's GPS track as a polyline,
 * every frame as a numbered dot where it was shot, and the matched segments drawn
 * in their real geometry. Unmatched frames are greyed so an admin can see at a
 * glance where the walk fell off the network; excluded frames dim and deleted ones
 * go to a tombstone colour, so the map tells the same story the filmstrip does.
 *
 * Selection is bidirectional: tapping a dot opens that frame in the inspector, and
 * selecting a frame anywhere highlights its dot and its segment here. Built the way
 * the app's other maps are — imperative MapLibre over the token-free OpenFreeMap
 * style, with the demotiles fallback — since there is no shared map hook.
 *
 * Frame positions come from capture_frames.location (the same source the pipeline
 * wrote at match time), never a second interpolation that could drift.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useTranslations } from "next-intl";
import type { ReviewFrame, FramePosition } from "@/lib/capture/review-store";

// Mirrors the private constants in components/AuditMap.tsx (kept private there).
const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export type MatchedGeometry = { id: string; coordinates: [number, number][] };

type FrameKind = "matched" | "unmatched" | "excluded" | "deleted";

function frameKind(frame: ReviewFrame, excluded: boolean, deleted: boolean): FrameKind {
  if (deleted) return "deleted";
  if (excluded) return "excluded";
  return frame.segmentId ? "matched" : "unmatched";
}

/** Build the frame-dot GeoJSON from the current selection/exclusion state. */
function framesGeoJson(
  frames: readonly ReviewFrame[],
  excluded: Set<number>,
  deleted: Set<number>,
  selectedSeq: number | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: frames
      .filter((f) => f.position)
      .map((f) => ({
        type: "Feature",
        properties: {
          seq: f.seq,
          kind: frameKind(f, excluded.has(f.seq), f.deleted || deleted.has(f.seq)),
          selected: f.seq === selectedSeq,
        },
        geometry: { type: "Point", coordinates: [f.position!.lng, f.position!.lat] },
      })),
  };
}

export default function ReviewMap({
  track,
  frames,
  matchedGeometry,
  excludedSeqs,
  deletedSeqs,
  selectedSeq,
  selectedSegmentId,
  onSelectFrame,
  variant = "panel",
}: Readonly<{
  track: readonly FramePosition[];
  frames: readonly ReviewFrame[];
  matchedGeometry: readonly MatchedGeometry[];
  excludedSeqs: number[];
  deletedSeqs: number[];
  selectedSeq: number | null;
  selectedSegmentId: string | null;
  onSelectFrame: (seq: number) => void;
  /** "panel" is the fixed-height card; "expanded" fills its container (full-viewport overlay). */
  variant?: "panel" | "expanded";
}>) {
  const t = useTranslations("admin.capture");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const selectRef = useRef(onSelectFrame);
  useEffect(() => {
    selectRef.current = onSelectFrame;
  }, [onSelectFrame]);
  const prevSegmentRef = useRef<string | null>(null);

  const excluded = new Set(excludedSeqs);
  const deleted = new Set(deletedSeqs);

  // Init once. All subsequent updates go through setData / setFeatureState below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let fallbackApplied = false;
    map.on("error", () => {
      if (!loadedRef.current && !fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(FALLBACK_STYLE_URL);
      }
    });

    map.on("load", () => {
      loadedRef.current = true;
      map.resize();

      // Matched segment geometry, promoteId so feature-state keys by segment id.
      map.addSource("review-segments", {
        type: "geojson",
        promoteId: "id",
        data: {
          type: "FeatureCollection",
          features: matchedGeometry.map((g) => ({
            type: "Feature",
            id: g.id,
            properties: { id: g.id },
            geometry: { type: "LineString", coordinates: g.coordinates },
          })),
        },
      });
      map.addLayer({
        id: "review-segments-line",
        type: "line",
        source: "review-segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#B4472F", "#3B7A63"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 6, 4],
          "line-opacity": 0.85,
        },
      });

      // The GPS track: white casing under an ink line, same idiom as TrackMiniMap.
      const trackCoords = track.map((p) => [p.lng, p.lat] as [number, number]);
      map.addSource("review-track", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: trackCoords },
        },
      });
      map.addLayer({
        id: "review-track-casing",
        type: "line",
        source: "review-track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 5, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "review-track-line",
        type: "line",
        source: "review-track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#111111", "line-width": 2, "line-dasharray": [1.5, 1] },
      });

      // Frame dots, coloured by kind, with a numbered label.
      map.addSource("review-frames", {
        type: "geojson",
        data: framesGeoJson(frames, excluded, deleted, selectedSeq),
      });
      map.addLayer({
        id: "review-frames-dots",
        type: "circle",
        source: "review-frames",
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 6.5],
          "circle-color": [
            "match",
            ["get", "kind"],
            "matched", "#111111",
            "unmatched", "#9AA097",
            "excluded", "#C9CCC6",
            "deleted", "#B4472F",
            "#111111",
          ],
          "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#B4472F", "#FFFFFF"],
          "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 1.5],
          "circle-opacity": ["case", ["==", ["get", "kind"], "excluded"], 0.55, 1],
        },
      });
      map.addLayer({
        id: "review-frames-labels",
        type: "symbol",
        source: "review-frames",
        layout: {
          "text-field": ["to-string", ["get", "seq"]],
          "text-size": 10,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#FFFFFF", "text-halo-color": "#111111", "text-halo-width": 1.2 },
      });

      map.on("click", "review-frames-dots", (e) => {
        const seq = e.features?.[0]?.properties?.seq;
        if (typeof seq === "number") selectRef.current(seq);
        else if (typeof seq === "string") selectRef.current(Number(seq));
      });
      map.on("mouseenter", "review-frames-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "review-frames-dots", () => {
        map.getCanvas().style.cursor = "";
      });

      // Fit to everything the walk touched.
      const all: [number, number][] = [
        ...trackCoords,
        ...frames.filter((f) => f.position).map((f) => [f.position!.lng, f.position!.lat] as [number, number]),
        ...matchedGeometry.flatMap((g) => g.coordinates),
      ];
      if (all.length > 0) {
        const bounds = all.reduce(
          (acc, c) => acc.extend(c),
          new maplibregl.LngLatBounds(all[0], all[0]),
        );
        map.fitBounds(bounds, { padding: 36, animate: false, maxZoom: 17 });
      }
    });

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // Init is intentionally one-shot; live updates are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-draw frame dots when exclusion/deletion/selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource("review-frames") as maplibregl.GeoJSONSource | undefined;
    source?.setData(framesGeoJson(frames, excluded, deleted, selectedSeq));
    // excluded/deleted are fresh Sets each render; depend on the array props instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, excludedSeqs, deletedSeqs, selectedSeq]);

  // Highlight the selected segment.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const prev = prevSegmentRef.current;
    if (prev && prev !== selectedSegmentId) {
      map.setFeatureState({ source: "review-segments", id: prev }, { selected: false });
    }
    if (selectedSegmentId) {
      map.setFeatureState({ source: "review-segments", id: selectedSegmentId }, { selected: true });
    }
    prevSegmentRef.current = selectedSegmentId;
  }, [selectedSegmentId]);

  const expanded = variant === "expanded";
  return (
    <div
      className={
        expanded
          ? "h-full w-full overflow-hidden"
          : "overflow-hidden rounded-[8px] border border-border"
      }
    >
      <div
        ref={containerRef}
        role="application"
        aria-label={t("mapLabel")}
        className={expanded ? "h-full min-h-0 w-full" : "h-56 w-full sm:h-64"}
      />
    </div>
  );
}
