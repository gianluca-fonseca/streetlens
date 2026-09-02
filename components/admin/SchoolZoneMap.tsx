"use client";

/**
 * The zone, as the score actually sees it.
 *
 * The public map answers "how safe is the walk to this school". This one
 * answers a different question — "which streets is that number made of, and
 * which ones are missing" — so it drops the score ramp entirely and paints by
 * ROLE instead:
 *
 *   gate ring, counted      solid ink, thick. Counts double in the score.
 *   walk ring, counted      solid ink, thin.
 *   in the zone, unrecorded accent, dashed. The field backlog.
 *   vetoing the school      accent, thick and solid. The segment that caps the
 *                           whole school regardless of its average.
 *
 * Painting by role rather than by score is the point. An editor checking a
 * school's number needs to see the SHAPE of the evidence — where it is thin,
 * where the double-weighted frontage is, which single block is doing the
 * damage. A score ramp would answer a question they are not asking and hide
 * the one they are.
 *
 * Selection is bidirectional with the contribution table beside it, the same
 * contract ReviewMap has with the filmstrip: click a street, the row
 * highlights; hover a row, the street lights.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BASEMAP, geodesicCircle } from "@/components/mapConfig";
import { useTheme } from "@/components/ThemeProvider";
import "maplibre-gl/dist/maplibre-gl.css";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const SEG_SOURCE = "zone-segments";
const SEG_LAYER = "zone-segments-line";
const RING_SOURCE = "zone-rings";
const RING_FILL = "zone-rings-fill";
const RING_LINE = "zone-rings-line";
const PIN_SOURCE = "zone-school";
const PIN_LAYER = "zone-school-pin";

export type ZoneSegmentGeometry = {
  id: string;
  coordinates: [number, number][];
  ring: "gate" | "walk";
  assessed: boolean;
  veto: boolean;
  name: string;
};

/** Muted basemap, matching the app's other maps. */
function muteBasemap(map: maplibregl.Map, dark: boolean) {
  const pal = dark ? BASEMAP.dark : BASEMAP.light;
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    try {
      if (layer.type === "background") {
        map.setPaintProperty(id, "background-color", pal.land);
      } else if (layer.type === "fill" && /water/.test(id)) {
        map.setPaintProperty(id, "fill-color", pal.water);
      } else if (layer.type === "fill") {
        map.setPaintProperty(id, "fill-color", pal.landuse);
      } else if (layer.type === "line") {
        map.setPaintProperty(id, "line-color", pal.roadMinor);
      } else if (layer.type === "symbol") {
        map.setPaintProperty(id, "text-color", pal.labelMinor);
        map.setPaintProperty(id, "text-halo-color", pal.labelHalo);
      }
    } catch {
      /* layer does not carry that property */
    }
  }
}

function segmentsGeoJson(segments: ZoneSegmentGeometry[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((s) => ({
      type: "Feature",
      id: s.id,
      properties: {
        id: s.id,
        name: s.name,
        ring: s.ring,
        assessed: s.assessed,
        veto: s.veto,
      },
      geometry: { type: "LineString", coordinates: s.coordinates },
    })),
  };
}

export default function SchoolZoneMap({
  center,
  gateRadiusM,
  walkRadiusM,
  segments,
  selectedId,
  onSelect,
}: Readonly<{
  center: [number, number];
  gateRadiusM: number;
  walkRadiusM: number;
  segments: ZoneSegmentGeometry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}>) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const segmentsRef = useRef(segments);
  const onSelectRef = useRef(onSelect);
  const darkRef = useRef(dark);

  useEffect(() => {
    segmentsRef.current = segments;
    onSelectRef.current = onSelect;
    darkRef.current = dark;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      center,
      zoom: 15.2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let fallbackApplied = false;
    map.on("error", () => {
      if (!fallbackApplied && !readyRef.current) {
        fallbackApplied = true;
        map.setStyle(FALLBACK_STYLE_URL);
      }
    });

    map.on("load", () => {
      const isDark = darkRef.current;
      muteBasemap(map, isDark);
      const ink = isDark ? "#f2f2f2" : "#111111";
      const accent = isDark ? "#ff4fa3" : "#c0106b";
      const paper = isDark ? "#0a0a0a" : "#fafafa";

      map.addSource(RING_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: (
            [
              ["walk", walkRadiusM],
              ["gate", gateRadiusM],
            ] as const
          ).map(([ring, radius]) => ({
            type: "Feature",
            properties: { ring },
            geometry: { type: "Polygon", coordinates: [geodesicCircle(center, radius)] },
          })),
        },
      });
      map.addLayer({
        id: RING_FILL,
        type: "fill",
        source: RING_SOURCE,
        filter: ["==", ["get", "ring"], "walk"],
        paint: { "fill-color": accent, "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: RING_LINE,
        type: "line",
        source: RING_SOURCE,
        paint: {
          "line-color": accent,
          "line-width": 1.2,
          "line-opacity": 0.55,
          "line-dasharray": ["case", ["==", ["get", "ring"], "gate"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      });

      map.addSource(SEG_SOURCE, {
        type: "geojson",
        data: segmentsGeoJson(segmentsRef.current),
        promoteId: "id",
      });
      map.addLayer({
        id: SEG_LAYER,
        type: "line",
        source: SEG_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          // Role, not score. Veto first — it is the thing that decides the tier.
          "line-color": [
            "case",
            ["get", "veto"],
            accent,
            ["!", ["get", "assessed"]],
            accent,
            ink,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            7,
            ["get", "veto"],
            6,
            ["==", ["get", "ring"], "gate"],
            4.5,
            2.5,
          ],
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1,
            ["!", ["get", "assessed"]],
            0.85,
            0.7,
          ],
          "line-dasharray": ["case", ["!", ["get", "assessed"]], ["literal", [1.4, 1.1]], ["literal", [1, 0]]],
        },
      });

      map.addSource(PIN_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: center } }],
        },
      });
      map.addLayer({
        id: PIN_LAYER,
        type: "circle",
        source: PIN_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": ink,
          "circle-stroke-color": paper,
          "circle-stroke-width": 2.5,
        },
      });

      map.on("click", SEG_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.id;
        onSelectRef.current(typeof id === "string" ? id : null);
      });
      map.on("mousemove", SEG_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SEG_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });

      // Frame the whole zone rather than trusting the initial zoom: a school
      // with a sparse walkshed and one with a dense one need different framings.
      const ring = geodesicCircle(center, walkRadiusM);
      const bounds = ring.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(ring[0], ring[0]),
      );
      map.fitBounds(bounds, { padding: 28, duration: 0 });

      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [center, gateRadiusM, walkRadiusM]);

  // Selection mirrored onto the map. feature-state rather than a filter so the
  // paint expression stays one layer and MapLibre does not re-tessellate.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (prevSelected.current) {
      map.setFeatureState({ source: SEG_SOURCE, id: prevSelected.current }, { selected: false });
    }
    if (selectedId) {
      map.setFeatureState({ source: SEG_SOURCE, id: selectedId }, { selected: true });
    }
    prevSelected.current = selectedId;
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="School zone segments"
      className="h-[380px] w-full overflow-hidden rounded-[8px] border border-border"
    />
  );
}
