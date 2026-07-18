"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { LineString } from "geojson";
import { sampleRamp } from "@/components/mapConfig";
import "maplibre-gl/dist/maplibre-gl.css";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type SegmentMiniMapProps = Readonly<{
  geometry: LineString;
  overallScore: number;
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

    const lineColor = sampleRamp("overall", overallScore);

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
        paint: { "line-color": lineColor, "line-width": 3.5 },
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
