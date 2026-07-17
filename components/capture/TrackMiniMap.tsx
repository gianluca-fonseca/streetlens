"use client";

/**
 * The walked track, drawn on the review screen.
 *
 * Non-interactive on purpose: it is evidence of where the phone thinks it went,
 * not a map to explore. It is drawn from the raw fixes with no smoothing, so a
 * jittery track looks jittery. That is the honest picture, and it is also the
 * fastest way for a walker to notice their GPS was bad.
 *
 * The line is ink, not pink. Flash pink is signal-only (CTA fill, active state,
 * the LIVE dot) and a recorded track is none of those. The white casing keeps a
 * black line legible over the basemap in either theme, since the tiles are light
 * regardless.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { TrackPoint } from "@/lib/capture/types";

// Mirrors the constant in `components/AuditMap.tsx`, which keeps it private.
// Duplicated rather than exported: AuditMap is outside this unit's scope and the
// manual flow stays untouched.
const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function TrackMiniMap({ track }: Readonly<{ track: readonly TrackPoint[] }>) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || track.length < 2) return;

    const coordinates = track.map((point) => [point.lng, point.lat] as [number, number]);

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      interactive: false,
      attributionControl: { compact: true },
    });

    map.on("load", () => {
      map.addSource("walk", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });
      map.addLayer({
        id: "walk-casing",
        type: "line",
        source: "walk",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 6, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "walk-line",
        type: "line",
        source: "walk",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#111111", "line-width": 2.5 },
      });

      const bounds = coordinates.reduce(
        (acc, coordinate) => acc.extend(coordinate),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
      );
      // No animation: this mounts already showing the finished walk, and a fly-in
      // would be idle motion the design direction rules out.
      map.fitBounds(bounds, { padding: 28, animate: false, maxZoom: 17 });
    });

    return () => map.remove();
  }, [track]);

  return <div ref={containerRef} className="size-full" aria-hidden="true" />;
}
