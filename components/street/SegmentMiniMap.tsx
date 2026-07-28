"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { LineString } from "geojson";
import { COMMUNITY_CASING, sampleRamp } from "@/components/mapConfig";
import "maplibre-gl/dist/maplibre-gl.css";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type SegmentMiniMapProps = Readonly<{
  geometry: LineString;
  /**
   * The overall score, or null when no audit stands behind this street. Null
   * draws the neutral dashed casing the map already uses for unaudited
   * segments: a ramp colour is itself a reading, and there is nothing to read.
   */
  overallScore: number | null;
}>;

/**
 * Non-interactive segment preview for the street report card.
 * The line is tinted with the overall ramp colour so the card reads as an instrument.
 */
export default function SegmentMiniMap({ geometry, overallScore }: SegmentMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const coordinates = geometry.coordinates;
    if (!container || coordinates.length < 2) return;

    const audited = overallScore !== null;
    // The mini-map keeps Liberty's own LIGHT basemap (it is never re-tinted for
    // the app theme) and draws the line over a white casing, so it always wants
    // the light half of the ramp regardless of what the page around it is doing.
    const lineColor = audited
      ? sampleRamp("overall", overallScore, "light")
      : COMMUNITY_CASING.color;

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      interactive: false,
      attributionControl: { compact: true },
    });

    map.on("load", () => {
      map.addSource("segment", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry,
        },
      });
      map.addLayer({
        id: "segment-casing",
        type: "line",
        source: "segment",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 7, "line-opacity": 0.92 },
      });
      map.addLayer({
        id: "segment-line",
        type: "line",
        source: "segment",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": lineColor,
          "line-width": 3.5,
          // Dashed reads as provisional, the same signal the map gives an
          // unaudited segment.
          ...(audited ? {} : { "line-dasharray": [...COMMUNITY_CASING.dash] }),
        },
      });

      const bounds = coordinates.reduce(
        (acc: maplibregl.LngLatBounds, coordinate: number[]) =>
          acc.extend(coordinate as [number, number]),
        new maplibregl.LngLatBounds(
          coordinates[0] as [number, number],
          coordinates[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: 36, animate: false, maxZoom: 17 });
    });

    return () => map.remove();
  }, [geometry, overallScore]);

  return <div ref={containerRef} className="h-full w-full" aria-hidden="true" />;
}
