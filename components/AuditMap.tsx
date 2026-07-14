"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useTranslations } from "next-intl";
import type { FeatureCollection, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

export type SegmentProperties = {
  id: string;
  name: string;
  score_overall: number;
  score_accessibility: number;
  score_drainage: number;
  score_shade: number;
  demo: boolean;
};

export type SegmentCollection = FeatureCollection<
  LineString,
  SegmentProperties
>;

type PopupLabels = {
  demoTag: string;
  overall: string;
  accessibility: string;
  drainage: string;
  shade: string;
};

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const ESCAZU_CENTER: [number, number] = [-84.14, 9.919];
const INITIAL_ZOOM = 14;
const SEGMENTS_SOURCE_ID = "demo-segments";
const SEGMENTS_LAYER_ID = "demo-segments-line";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPopupHtml(
  properties: SegmentProperties,
  labels: PopupLabels,
): string {
  const scoreRow = (label: string, score: number) =>
    `<div style="display:flex;justify-content:space-between;gap:16px;">
      <span>${escapeHtml(label)}</span>
      <span style="font-variant-numeric:tabular-nums;font-weight:600;">${score}</span>
    </div>`;

  return `<div style="font:13px/1.5 var(--font-geist-sans, system-ui, sans-serif);color:#171717;min-width:200px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <strong>${escapeHtml(properties.name)}</strong>
      <span style="background:#fbbf24;color:#451a03;font-size:10px;font-weight:700;letter-spacing:0.05em;padding:1px 6px;border-radius:9999px;">${escapeHtml(labels.demoTag)}</span>
    </div>
    ${scoreRow(labels.overall, properties.score_overall)}
    ${scoreRow(labels.accessibility, properties.score_accessibility)}
    ${scoreRow(labels.drainage, properties.score_drainage)}
    ${scoreRow(labels.shade, properties.score_shade)}
  </div>`;
}

export default function AuditMap({
  segments,
}: Readonly<{
  segments: SegmentCollection;
}>) {
  const t = useTranslations("map");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const labels: PopupLabels = {
    demoTag: t("demoTag"),
    overall: t("scores.overall"),
    accessibility: t("scores.accessibility"),
    drainage: t("scores.drainage"),
    shade: t("scores.shade"),
  };

  // Refs so the map effect can run exactly once while always reading
  // current values (locale-dependent labels, build-time segment data).
  const labelsRef = useRef(labels);
  const segmentsRef = useRef(segments);
  useEffect(() => {
    labelsRef.current = labels;
    segmentsRef.current = segments;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      center: ESCAZU_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // If the Liberty style fails to load, fall back to the MapLibre demo tiles.
    let styleLoaded = false;
    let fallbackApplied = false;
    map.on("error", () => {
      if (!styleLoaded && !fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(FALLBACK_STYLE_URL);
      }
    });

    map.on("load", () => {
      styleLoaded = true;

      map.addSource(SEGMENTS_SOURCE_ID, {
        type: "geojson",
        data: segmentsRef.current,
      });

      map.addLayer({
        id: SEGMENTS_LAYER_ID,
        type: "line",
        source: SEGMENTS_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          // Red -> amber -> green ramp on the overall score (0-100).
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "score_overall"],
            0,
            "#dc2626",
            50,
            "#f59e0b",
            100,
            "#16a34a",
          ],
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      map.on("click", SEGMENTS_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }
        const properties = feature.properties as SegmentProperties;
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
          .setLngLat(event.lngLat)
          .setHTML(buildPopupHtml(properties, labelsRef.current))
          .addTo(map);
      });

      map.on("mouseenter", SEGMENTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SEGMENTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={t("ariaLabel")}
      className="h-[480px] w-full"
    />
  );
}
