"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useTranslations } from "next-intl";
import type { ExpressionSpecification } from "maplibre-gl";
import type {
  ScoreLayer,
  SegmentCollection,
  SegmentProperties,
  StreetStats,
} from "@/lib/segments";
import {
  BASEMAP,
  lineColorExpression,
  lineWidthExpression,
} from "@/components/mapConfig";
import MapPanel from "@/components/MapPanel";
import SegmentDetail from "@/components/SegmentDetail";
import ContributeUI from "@/components/contribute/ContributeUI";
import { useContribute } from "@/components/contribute/useContribute";
import "maplibre-gl/dist/maplibre-gl.css";

export type { SegmentCollection } from "@/lib/segments";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const ESCAZU_CENTER: [number, number] = [-84.138, 9.912];
const INITIAL_ZOOM = 13.4;
const SOURCE_ID = "segments";
const LINE_LAYER_ID = "segments-line";
const GLOW_LAYER_ID = "segments-glow";

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Strip POIs / most labels and recolor Liberty to a calm warm-neutral basemap. */
function muteBasemap(map: maplibregl.Map, dark: boolean) {
  const pal = dark ? BASEMAP.dark : BASEMAP.light;
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id;
    const set = (prop: string, value: string) => {
      try {
        map.setPaintProperty(id, prop, value);
      } catch {
        /* layer uses a different paint prop; ignore */
      }
    };
    const hide = () => {
      try {
        map.setLayoutProperty(id, "visibility", "none");
      } catch {
        /* no-op */
      }
    };

    if (layer.type === "symbol") {
      // Keep a restrained place-label hierarchy; drop POIs and the rest.
      const keep = /place|city|town|state|country|continent/i.test(id);
      if (!keep) hide();
      continue;
    }
    if (layer.type === "background") {
      set("background-color", pal.land);
      continue;
    }
    if (layer.type === "fill") {
      if (/water|ocean|sea|river|lake/i.test(id)) set("fill-color", pal.water);
      else if (/park|wood|forest|grass|green|landcover|meadow|scrub/i.test(id))
        set("fill-color", pal.park);
      else if (/building/i.test(id)) set("fill-color", pal.building);
      else set("fill-color", pal.landuse);
      continue;
    }
    if (layer.type === "line") {
      if (/water|river|canal|stream/i.test(id)) set("line-color", pal.water);
      else if (/boundary|admin|border/i.test(id))
        set("line-color", pal.boundary);
      else if (/motorway|trunk|primary|secondary|main/i.test(id))
        set("line-color", pal.road);
      else set("line-color", pal.roadMinor);
    }
  }
}

function addDataLayers(map: maplibregl.Map, data: SegmentCollection) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data,
      promoteId: "id",
    });
  }

  const color = lineColorExpression("overall");
  const width = lineWidthExpression("overall");
  const glowWidth = ["+", width, 7] as unknown as ExpressionSpecification;

  // Glow sits UNDER the main line and only shows in dark mode (data-only glow).
  if (!map.getLayer(GLOW_LAYER_ID)) {
    map.addLayer({
      id: GLOW_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": glowWidth,
        "line-blur": 5,
        "line-opacity": 0,
      },
    });
  }

  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": width,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0.82,
        ],
      },
    });
  }
}

/** Repaint the data layers for a score layer; glow is data-only + dark-only. */
function applyLayer(map: maplibregl.Map, layer: ScoreLayer, dark: boolean) {
  const color = lineColorExpression(layer);
  const width = lineWidthExpression(layer);
  const glowWidth = ["+", width, 7] as unknown as ExpressionSpecification;
  try {
    map.setPaintProperty(LINE_LAYER_ID, "line-color", color);
    map.setPaintProperty(LINE_LAYER_ID, "line-width", width);
    map.setPaintProperty(GLOW_LAYER_ID, "line-color", color);
    map.setPaintProperty(GLOW_LAYER_ID, "line-width", glowWidth);
    map.setPaintProperty(GLOW_LAYER_ID, "line-opacity", dark ? 0.5 : 0);
  } catch {
    /* layers not ready yet */
  }
}

export default function AuditMap({
  segments,
  stats,
}: Readonly<{
  segments: SegmentCollection;
  stats: StreetStats;
}>) {
  const t = useTranslations("map");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

  const [activeLayer, setActiveLayer] = useState<ScoreLayer>("overall");
  const [selected, setSelected] = useState<SegmentProperties | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Map-integrated contribution flow (owns its own draw layers + handlers).
  const contribute = useContribute(mapRef, mapReady);

  const activeLayerRef = useRef(activeLayer);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const segmentsRef = useRef(segments);
  // Keep the latest contribute API reachable from the once-created map handlers
  // without re-running the map-init effect.
  const contributeRef = useRef(contribute);
  useEffect(() => {
    activeLayerRef.current = activeLayer;
    segmentsRef.current = segments;
    contributeRef.current = contribute;
  });

  // Create the map exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      center: ESCAZU_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let styleLoaded = false;
    let fallbackApplied = false;
    map.on("error", () => {
      if (!styleLoaded && !fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(FALLBACK_STYLE_URL);
      }
    });

    const onLoad = () => {
      styleLoaded = true;
      map.resize();
      const dark = prefersDark();
      muteBasemap(map, dark);
      addDataLayers(map, segmentsRef.current);

      // Apply the current active layer + dark-mode glow.
      applyLayer(map, activeLayerRef.current, dark);
      readyRef.current = true;
      setMapReady(true);

      map.on("mousemove", LINE_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const id = String(f.id ?? (f.properties as SegmentProperties).id);
        if (hoveredIdRef.current && hoveredIdRef.current !== id) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false },
          );
        }
        hoveredIdRef.current = id;
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
      });
      map.on("mouseleave", LINE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredIdRef.current) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false },
          );
          hoveredIdRef.current = null;
        }
      });

      map.on("click", LINE_LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as SegmentProperties;
        // Gate for the contribution flow: swallow the click while tracing,
        // and route it to the correction form while picking a segment.
        const contrib = contributeRef.current;
        const cmode = contrib.modeRef.current;
        if (cmode === "trace") return;
        if (cmode === "select") {
          const geom = f.geometry;
          const coordinates =
            geom.type === "LineString"
              ? (geom.coordinates as [number, number][])
              : [];
          contrib.pickSegment({ id: props.id, name: props.name, coordinates });
          return;
        }
        selectFeature(map, props, f.geometry);
        setSelected(props);
      });
    };
    map.on("load", onLoad);

    // Re-apply muting after a fallback style loads.
    map.on("styledata", () => {
      if (fallbackApplied && map.isStyleLoaded()) {
        muteBasemap(map, prefersDark());
      }
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // React to prefers-color-scheme changes (basemap + data glow).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const dark = mq.matches;
      muteBasemap(map, dark);
      applyLayer(map, activeLayerRef.current, dark);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Repaint when the active score layer changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyLayer(map, activeLayer, prefersDark());
  }, [activeLayer]);

  const handleClose = () => {
    const map = mapRef.current;
    if (map && selectedIdRef.current) {
      map.setFeatureState(
        { source: SOURCE_ID, id: selectedIdRef.current },
        { selected: false },
      );
      selectedIdRef.current = null;
    }
    setSelected(null);
  };

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        role="application"
        aria-label={t("ariaLabel")}
        className="h-full w-full"
      />

      <div className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-none">
          <MapPanel
            stats={stats}
            activeLayer={activeLayer}
            onSelectLayer={setActiveLayer}
          />
        </div>
        {selected ? (
          <div className="pointer-events-none">
            <SegmentDetail
              segment={selected}
              activeLayer={activeLayer}
              onClose={handleClose}
            />
          </div>
        ) : null}
      </div>

      <ContributeUI contribute={contribute} />
    </div>
  );

  // --- selection helper (closes over component refs) -----------------------

  function selectFeature(
    map: maplibregl.Map,
    props: SegmentProperties,
    geometry: GeoJSON.Geometry,
  ) {
    if (selectedIdRef.current) {
      map.setFeatureState(
        { source: SOURCE_ID, id: selectedIdRef.current },
        { selected: false },
      );
    }
    selectedIdRef.current = props.id;
    map.setFeatureState({ source: SOURCE_ID, id: props.id }, { selected: true });

    // Smooth fly-to: fit the segment with padding for the floating panels.
    if (geometry.type === "LineString") {
      const coords = geometry.coordinates as [number, number][];
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds, {
        padding: { top: 90, bottom: 60, left: 360, right: 380 },
        maxZoom: 16.5,
        duration: 1100,
        essential: true,
      });
    }
  }
}
