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
  BUILDINGS,
  COMMUNITY_CASING,
  COMMUNITY_LAYER_FILTER,
  CV_CASING,
  CV_LAYER_FILTER,
  HILLSHADE_LAYER_ID,
  HILLSHADE_PAINT,
  RAMP_LAYER_FILTER,
  TERRAIN,
  communityWidthExpression,
  cvWidthExpression,
  lineColorExpression,
  lineWidthExpression,
} from "@/components/mapConfig";
import { parseFeatureProps } from "@/lib/parse-feature-props";
import MapPanel from "@/components/MapPanel";
import ThreeDToggle from "@/components/ThreeDToggle";
import SegmentDetail from "@/components/SegmentDetail";
import ContributeUI from "@/components/contribute/ContributeUI";
import { useContribute } from "@/components/contribute/useContribute";
import { cn } from "@/components/ui/cn";
import "maplibre-gl/dist/maplibre-gl.css";

export type { SegmentCollection } from "@/lib/segments";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const ESCAZU_CENTER: [number, number] = [-84.138, 9.912];
const INITIAL_ZOOM = 13.4;
const SOURCE_ID = "segments";
const LINE_LAYER_ID = "segments-line";
const GLOW_LAYER_ID = "segments-glow";
const COMMUNITY_LAYER_ID = "segments-community";
const CV_LAYER_ID = "segments-cv";
/**
 * Layers that respond to hover / click (score ramp + community + camera casing).
 * The CV layer must be here: it draws the features it steals from the community
 * filter, so leaving it out would make a camera-observed import segment
 * unclickable.
 */
const INTERACTIVE_LAYER_IDS = [LINE_LAYER_ID, COMMUNITY_LAYER_ID, CV_LAYER_ID];

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Hero camera signature: one gentle scripted glide across the Escazú corridor. */
const HERO_START: { center: [number, number]; zoom: number; bearing: number } = {
  center: [-84.15, 9.9],
  zoom: 13.0,
  bearing: -6,
};
const HERO_END: { center: [number, number]; zoom: number; bearing: number } = {
  center: [-84.137, 9.915],
  zoom: 14.1,
  bearing: 4,
};

/**
 * Recolour Liberty into the calm zen basemap, keeping its labels.
 *
 * This used to hide every symbol layer except place labels, which left the
 * public map without street names or businesses while the admin ReviewMap
 * (same Liberty style, unstripped) had them. The label hierarchy is now kept
 * whole and *tuned* rather than removed: recoloured into the palette with a
 * halo so it stays legible over the score casings in both themes.
 */
function muteBasemap(map: maplibregl.Map, dark: boolean) {
  const pal = dark ? BASEMAP.dark : BASEMAP.light;
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id;
    const set = (prop: string, value: string | number) => {
      try {
        map.setPaintProperty(id, prop, value);
      } catch {
        /* layer uses a different paint prop; ignore */
      }
    };
    if (layer.type === "symbol") {
      // Keep every label category — place, street, business, POI — and tune it
      // into the palette. Places carry the full label ink; the denser street /
      // POI tier sits a step lighter so it never shouts over the score ramps.
      // The halo is the page ground, which is what keeps a name readable where
      // it crosses a segment casing.
      const isPlace = /place|city|town|state|country|continent/i.test(id);
      set("text-color", isPlace ? pal.label : pal.labelMinor);
      set("text-halo-color", pal.labelHalo);
      set("text-halo-width", 1.25);
      set("text-halo-blur", 0.3);
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
  // The score-ramp layers draw the audited set only; community/import segments
  // are excluded here and drawn by the neutral casing layer below.
  if (!map.getLayer(GLOW_LAYER_ID)) {
    map.addLayer({
      id: GLOW_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: RAMP_LAYER_FILTER,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": glowWidth,
        "line-blur": 5,
        "line-opacity": 0,
      },
    });
  }

  // Community / import segments: fixed neutral warm-grey dashed casing, never a
  // score color (contract v3, ruling 1). Verified in applyLayer for dark mode.
  // Added BEFORE the CV casing and the score line so the draw order runs
  // glow → neutral → camera-observed → score ramp (the three casing filters are
  // mutually exclusive, so ordering is about the CV halo, not overlap).
  if (!map.getLayer(COMMUNITY_LAYER_ID)) {
    map.addLayer({
      id: COMMUNITY_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: COMMUNITY_LAYER_FILTER,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COMMUNITY_CASING.color,
        "line-width": communityWidthExpression,
        "line-dasharray": COMMUNITY_CASING.dash,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0.85,
        ],
      },
    });
  }

  // Camera-observed segments (u31): the accent casing that makes a street the
  // cameras have actually seen unmistakable. It sits ABOVE the neutral overlay
  // and BELOW the score line, so on an audited segment it reads as a pink halo
  // around the score colour (which stays fully visible), and on an unaudited
  // import segment — the demo-off case, where everything else is neutral — it
  // is the mark itself.
  if (!map.getLayer(CV_LAYER_ID)) {
    map.addLayer({
      id: CV_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: CV_LAYER_FILTER,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": CV_CASING.color,
        "line-width": cvWidthExpression,
        "line-opacity": CV_CASING.opacity,
      },
    });
  }

  if (!map.getLayer(LINE_LAYER_ID)) {
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: RAMP_LAYER_FILTER,
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
    // Community casing is score-independent; only its neutral hue tracks theme.
    map.setPaintProperty(
      COMMUNITY_LAYER_ID,
      "line-color",
      dark ? COMMUNITY_CASING.colorDark : COMMUNITY_CASING.color,
    );
    // Likewise the camera casing: score-independent, only its accent tracks theme.
    map.setPaintProperty(
      CV_LAYER_ID,
      "line-color",
      dark ? CV_CASING.colorDark : CV_CASING.color,
    );
  } catch {
    /* layers not ready yet */
  }
}

/* ------------------------------------------------------------------ *
 * 3D mode (u8) — presentational only. These helpers add DEM terrain,
 * always-on hillshade, and OSM building extrusions. They never touch the
 * score data layers, the RAMP, or the line color/width expressions.
 * ------------------------------------------------------------------ */

/** First road-ish line layer id, so hillshade can be inserted beneath roads. */
function firstRoadLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (
      layer.type === "line" &&
      /road|highway|street|bridge|tunnel|transportation|motorway|trunk|primary|secondary/i.test(
        layer.id,
      )
    ) {
      return layer.id;
    }
  }
  return undefined;
}

/** The building extrusion layer present in the active style, if any. */
function buildingLayerId(map: maplibregl.Map): string | undefined {
  return BUILDINGS.layerIdCandidates.find((id) => map.getLayer(id));
}

/** Add the DEM source + always-on hillshade, and prime the (hidden) building
 * extrusions. Hillshade sits beneath roads so it never fights the score ramps. */
function setupTerrain(map: maplibregl.Map, dark: boolean) {
  if (!map.getSource(TERRAIN.sourceId)) {
    map.addSource(TERRAIN.sourceId, {
      type: "raster-dem",
      tiles: [...TERRAIN.tiles],
      encoding: TERRAIN.encoding,
      tileSize: TERRAIN.tileSize,
      maxzoom: TERRAIN.maxzoom,
      attribution: TERRAIN.attribution,
    });
  }
  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: TERRAIN.sourceId,
        layout: { visibility: "none" },
        paint: { ...(dark ? HILLSHADE_PAINT.dark : HILLSHADE_PAINT.light) },
      },
      firstRoadLayerId(map),
    );
  }
  // Reuse the style's building extrusion layer: mute it, coalesce heights, and
  // keep it hidden until 3D is enabled.
  const bid = buildingLayerId(map);
  if (bid) {
    try {
      map.setPaintProperty(
        bid,
        "fill-extrusion-color",
        dark ? BUILDINGS.color.dark : BUILDINGS.color.light,
      );
      map.setPaintProperty(bid, "fill-extrusion-height", BUILDINGS.heightExpression);
      map.setPaintProperty(bid, "fill-extrusion-base", BUILDINGS.baseExpression);
      map.setPaintProperty(bid, "fill-extrusion-opacity", BUILDINGS.opacity);
      map.setLayoutProperty(bid, "visibility", "none");
    } catch {
      /* style lacks the extrusion paint props; skip buildings */
    }
  }
}

/** Threshold (m) past which the map center is considered detached from the DEM
 * surface and in need of a re-clamp. Healthy deviation is a few metres of numeric
 * noise; a sunk camera sits hundreds of metres below the terrain. */
const CENTER_ELEVATION_TOLERANCE_M = 30;

/**
 * Re-clamp the map center onto the terrain surface.
 *
 * Root cause of the "zoom-in blanks the map in 3D" defect: when 3D is enabled
 * (or 3D is toggled on already zoomed in) before the center's Terrarium DEM tile
 * has loaded, MapLibre cannot resolve the center elevation and leaves the
 * transform's center altitude pinned at 0 (sea level). Escazú's terrain is
 * ~1500 m; with the center stuck at sea level, the fixed-altitude camera under
 * 60° pitch descends *below* the real terrain surface on any animated `easeTo`
 * zoom (the `+`/`-` controls, double-click) once it crosses the DEM source
 * maxzoom, so the frame renders nothing — a persistent white canvas that never
 * recovers. Smooth wheel zoom escapes this because its gesture handler freezes
 * elevation during the move and re-clamps when the DEM has settled.
 *
 * The fix mirrors that gesture-end behaviour for the animated path: once the DEM
 * has real data, nudge the center (a no-op position set) so MapLibre re-clamps
 * the center altitude to the loaded surface. Guarded by a tolerance so it is a
 * no-op in the healthy case and never loops on its own `setCenter`.
 */
function clampCenterToTerrain(map: maplibregl.Map) {
  if (!map.getTerrain()) return; // 2D — nothing to clamp
  const center = map.getCenter();
  const ground = map.queryTerrainElevation(center);
  // `queryTerrainElevation` reads 0 (not null) while the DEM tile is still
  // loading; comparing against the equally-0 center altitude keeps us from
  // clamping to a phantom sea-level surface. We simply retry on the next idle.
  if (ground == null) return;
  const centerElevation =
    (map.transform as unknown as { elevation?: number }).elevation ?? 0;
  if (Math.abs(centerElevation - ground) > CENTER_ELEVATION_TOLERANCE_M) {
    // Re-setting the current center forces MapLibre to re-derive the center
    // altitude from the now-loaded DEM, lifting the camera back above ground.
    map.setCenter(center);
  }
}

/** Toggle presentational 3D: terrain + eased pitch + building extrusions. */
function applyThreeD(map: maplibregl.Map, on: boolean, dark: boolean) {
  const bid = buildingLayerId(map);
  if (on) {
    setupTerrain(map, dark);
    map.setTerrain({
      source: TERRAIN.sourceId,
      exaggeration: TERRAIN.exaggeration,
    });
    if (map.getLayer(HILLSHADE_LAYER_ID)) {
      map.setLayoutProperty(HILLSHADE_LAYER_ID, "visibility", "visible");
    }
    if (bid) map.setLayoutProperty(bid, "visibility", "visible");
    map.easeTo({ pitch: 60, duration: 900, essential: true });
    // The DEM tile for the center may still be loading; clamp the center onto
    // the terrain as soon as it settles so subsequent animated zooms keep the
    // camera above ground instead of blanking the canvas.
    clampCenterToTerrain(map);
  } else {
    map.setTerrain(null);
    if (map.getLayer(HILLSHADE_LAYER_ID)) {
      map.setLayoutProperty(HILLSHADE_LAYER_ID, "visibility", "none");
    }
    if (bid) map.setLayoutProperty(bid, "visibility", "none");
    map.easeTo({ pitch: 0, bearing: 0, duration: 700, essential: true });
  }
}

/** Re-tint the always-on hillshade + building extrusions on theme change. */
function applyThreeDTheme(map: maplibregl.Map, dark: boolean) {
  if (map.getLayer(HILLSHADE_LAYER_ID)) {
    const paint = dark ? HILLSHADE_PAINT.dark : HILLSHADE_PAINT.light;
    for (const [prop, value] of Object.entries(paint)) {
      try {
        map.setPaintProperty(HILLSHADE_LAYER_ID, prop, value);
      } catch {
        /* not ready */
      }
    }
  }
  const bid = buildingLayerId(map);
  if (bid) {
    try {
      map.setPaintProperty(
        bid,
        "fill-extrusion-color",
        dark ? BUILDINGS.color.dark : BUILDINGS.color.light,
      );
    } catch {
      /* not ready */
    }
  }
}

export type AuditMapVariant = "app" | "hero";

export default function AuditMap({
  segments,
  stats,
  variant = "app",
  activeLayer: controlledLayer,
  flyOnLoad = false,
  interactive = false,
  onSegmentActivate,
  onMoveStateChange,
}: Readonly<{
  segments: SegmentCollection;
  stats?: StreetStats;
  variant?: AuditMapVariant;
  /** Externally controlled score layer (hero / scrollytelling). */
  activeLayer?: ScoreLayer;
  /** Run the gentle corridor fly-to on load (hero only, reduced-motion safe). */
  flyOnLoad?: boolean;
  /** Hero platform embed: pan / cooperative wheel-zoom / +- / tap-to-open. */
  interactive?: boolean;
  /** Called when a segment is tapped in the interactive hero (opens /map). */
  onSegmentActivate?: () => void;
  /** Fires true on movestart / false on moveend so the composing chrome can swap
   * its over-tile glass to a solid while the map moves (research §1 perf note). */
  onMoveStateChange?: (moving: boolean) => void;
}>) {
  const t = useTranslations("map");
  const isHero = variant === "hero";
  const heroInteractive = isHero && interactive;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);

  // In hero/scrollytelling mode the active layer is driven from outside; the
  // app surface keeps its own internal state via the layer switcher.
  const [internalLayer, setActiveLayer] = useState<ScoreLayer>("overall");
  const activeLayer = controlledLayer ?? internalLayer;
  const [selected, setSelected] = useState<SegmentProperties | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [threeD, setThreeD] = useState(false);
  // Transient cooperative-gesture hint (shown on a raw wheel over the hero map).
  const [wheelHint, setWheelHint] = useState(false);
  // App surface only: true while the map is panning/zooming so the over-tile chrome
  // (MapPanel / SegmentDetail popover / contribute panels / zoom controls) drops its
  // glass to a solid during the move — the costly re-blur-per-frame path (u18-A3).
  const [mapMoving, setMapMoving] = useState(false);

  // Map-integrated contribution flow (owns its own draw layers + handlers).
  const contribute = useContribute(mapRef, mapReady);

  const activeLayerRef = useRef(activeLayer);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const segmentsRef = useRef(segments);
  // Keep the latest contribute API reachable from the once-created map handlers
  // without re-running the map-init effect.
  const contributeRef = useRef(contribute);
  // Variant flags are fixed per mount but read inside the once-created map
  // effect through refs, matching how the rest of that effect avoids props.
  const isHeroRef = useRef(isHero);
  const flyOnLoadRef = useRef(flyOnLoad);
  const interactiveRef = useRef(heroInteractive);
  const onActivateRef = useRef(onSegmentActivate);
  const onMoveRef = useRef(onMoveStateChange);
  useEffect(() => {
    activeLayerRef.current = activeLayer;
    segmentsRef.current = segments;
    contributeRef.current = contribute;
    isHeroRef.current = isHero;
    flyOnLoadRef.current = flyOnLoad;
    interactiveRef.current = heroInteractive;
    onActivateRef.current = onSegmentActivate;
    onMoveRef.current = onMoveStateChange;
  });

  // Create the map exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hero = isHeroRef.current;
    const heroLive = hero && interactiveRef.current;
    // Cap pitch on touch / narrow viewports to bound horizon DEM-tile fetches
    // in 3D (research: mobile ≈60°, desktop 70°). Harmless for the hero, which
    // never leaves pitch 0.
    const coarsePointer =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640;
    const maxPitch = coarsePointer ? 60 : 70;

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      center: hero ? HERO_START.center : ESCAZU_CENTER,
      zoom: hero ? HERO_START.zoom : INITIAL_ZOOM,
      bearing: hero ? HERO_START.bearing : 0,
      maxPitch,
      attributionControl: { compact: true },
      // Static hero backdrop never hijacks scroll. The interactive platform hero
      // keeps MapLibre's cursor-anchored scroll-zoom but gates it to Cmd/Ctrl+wheel
      // in the capture phase below (cooperative-gesture policy, research §4).
      scrollZoom: !hero || heroLive,
    });
    mapRef.current = map;
    // The read-only hero has no map chrome. The app surface keeps the nav
    // control; visualizePitch renders the rotate/pitch dial used by 3D mode.
    if (!hero) {
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true }),
        "top-right",
      );
    }

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
      // DEM + hillshade load lazily when 3D is toggled on (applyThreeD).

      // Apply the current active layer + dark-mode glow.
      applyLayer(map, activeLayerRef.current, dark);
      readyRef.current = true;
      setMapReady(true);

      // Hero camera signature: one slow glide along the corridor, or a composed
      // static framing when reduced motion is requested (or no fly is wanted).
      if (hero) {
        if (flyOnLoadRef.current && !prefersReducedMotion()) {
          window.setTimeout(() => {
            map.flyTo({
              center: HERO_END.center,
              zoom: HERO_END.zoom,
              bearing: HERO_END.bearing,
              duration: 5200,
              curve: 1.35,
              essential: true,
            });
          }, 650);
        } else {
          map.jumpTo({
            center: HERO_END.center,
            zoom: HERO_END.zoom,
            bearing: HERO_END.bearing,
          });
        }
      }

      // Whenever the map settles in 3D, ensure the center is clamped onto the
      // DEM surface. This catches the initial "enabled before DEM loaded" race
      // and recovers from any transient underground camera an animated zoom may
      // produce while its DEM tiles are still in flight. No-op in 2D (and in the
      // hero, which never enables 3D).
      map.on("idle", () => clampCenterToTerrain(map));

      map.on("mousemove", INTERACTIVE_LAYER_IDS, (e) => {
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
      map.on("mouseleave", INTERACTIVE_LAYER_IDS, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredIdRef.current) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false },
          );
          hoveredIdRef.current = null;
        }
      });

      // Read-only hero has no selection popover; the app surface keeps it.
      if (!hero) {
        map.on("click", INTERACTIVE_LAYER_IDS, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          // maplibre serializes community_report/community_reports to JSON
          // strings at the worker boundary; normalize them here so both the ramp
          // and the community casing layer hand SegmentDetail well-formed props.
          const props = parseFeatureProps(f.properties);
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
        // Drop the over-tile glass chrome to solid while the map is in motion, then
        // restore on idle (same perf swap the interactive hero applies to its chips).
        map.on("movestart", () => setMapMoving(true));
        map.on("moveend", () => setMapMoving(false));
      }

      // Interactive hero: a segment tap opens the full platform (the mcbroken
      // pattern — every deeper action goes to /map; no new deep-link infra per
      // spec §Hero). Movestart/moveend surface up so the Hero can drop the glass
      // chips to solid while the map is in motion (research §1 perf note).
      if (heroLive) {
        map.on("click", INTERACTIVE_LAYER_IDS, () => onActivateRef.current?.());
        map.on("movestart", () => onMoveRef.current?.(true));
        map.on("moveend", () => onMoveRef.current?.(false));
      }
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
      applyThreeDTheme(map, dark);
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

  // Cooperative wheel gating (research §4): a plain wheel over the embedded hero
  // map scrolls the PAGE — we stop the event in the capture phase before it reaches
  // MapLibre's canvas handler (so it neither zooms nor preventDefaults the scroll)
  // and flash a transient hint. Cmd/Ctrl+wheel (and trackpad pinch, which the OS
  // reports as a ctrlKey wheel) passes through to MapLibre's cursor-anchored zoom.
  // Touch pan/pinch stay on the native handlers; the bounded map height leaves page
  // above and below to scroll.
  useEffect(() => {
    if (!heroInteractive) return;
    const container = containerRef.current;
    if (!container) return;
    let hideTimer: number | undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setWheelHint(false);
        return; // let MapLibre zoom around the cursor
      }
      e.stopPropagation();
      setWheelHint(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setWheelHint(false), 1400);
    };
    container.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      window.clearTimeout(hideTimer);
      container.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [heroInteractive, mapReady]);

  const handleToggleThreeD = (next: boolean) => {
    setThreeD(next);
    const map = mapRef.current;
    if (map && readyRef.current) applyThreeD(map, next, prefersDark());
  };

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

  if (isHero) {
    // Read-only backdrop OR the interactive platform embed. The informational
    // glass chips (LIVE / legend) are composed by the landing Hero over this
    // canvas; the map-coupled controls (zoom, cooperative-gesture hint) live here
    // because they need the map instance.
    return (
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          role="application"
          aria-label={t("ariaLabel")}
          className="h-full w-full"
        />
        {heroInteractive ? (
          <>
            {/* Explicit +/- zoom (mono, glass): the always-available non-scroll
                path so gating wheel-zoom never blocks the user. */}
            <div className="absolute bottom-3 right-3 z-10 flex flex-col">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
                aria-label={t("zoomIn")}
                className="sl-glass-chip flex h-9 w-9 items-center justify-center rounded-t-[10px] font-mono text-[19px] leading-none text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
                aria-label={t("zoomOut")}
                className="sl-glass-chip -mt-px flex h-9 w-9 items-center justify-center rounded-b-[10px] font-mono text-[19px] leading-none text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                −
              </button>
            </div>
            {/* Transient cooperative-gesture hint. */}
            <div
              aria-hidden={!wheelHint}
              className={cn(
                "sl-glass-chip pointer-events-none absolute inset-x-0 bottom-3 z-10 mx-auto flex w-max max-w-[calc(100%-5rem)] items-center rounded-full px-3.5 py-1.5 font-mono text-[11px] leading-none text-ink transition-opacity duration-200",
                wheelHint ? "opacity-100" : "opacity-0",
              )}
            >
              {t("zoomHint")}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="absolute inset-0" data-map-moving={mapMoving}>
      <div
        ref={containerRef}
        role="application"
        aria-label={t("ariaLabel")}
        className="h-full w-full"
      />

      {/* Top-left control cluster (thumb-reachable, stacked). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3 sm:p-4">
        <div className="pointer-events-none flex flex-col items-start gap-3">
          {stats ? (
            <MapPanel
              stats={stats}
              activeLayer={activeLayer}
              onSelectLayer={setActiveLayer}
            />
          ) : null}
          <ThreeDToggle active={threeD} onToggle={handleToggleThreeD} />
        </div>
      </div>

      {/* Segment detail: a bottom sheet on phones (map stays visible above,
          tap the scrim or drag the handle to dismiss), the sealed top-right
          popover on desktop. */}
      {selected ? (
        <>
          <button
            type="button"
            onClick={handleClose}
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 z-20 bg-[rgba(0,0,0,0.32)] md:hidden"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:block">
            <SegmentDetail
              key={selected.id}
              segment={selected}
              activeLayer={activeLayer}
              onClose={handleClose}
            />
          </div>
        </>
      ) : null}

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

    // Smooth fly-to: fit the segment clear of the chrome. On phones the detail is
    // a bottom sheet, so we frame the segment into the upper map band (big bottom
    // pad, slim sides); on desktop we clear the left panel and right popover.
    if (geometry.type === "LineString") {
      const coords = geometry.coordinates as [number, number][];
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      const isPhone =
        typeof window !== "undefined" && window.innerWidth < 768;
      const padding = isPhone
        ? {
            top: 96,
            bottom: Math.round(window.innerHeight * 0.5),
            left: 36,
            right: 36,
          }
        : { top: 90, bottom: 60, left: 360, right: 380 };
      map.fitBounds(bounds, {
        padding,
        maxZoom: 16.5,
        duration: 1100,
        essential: true,
      });
    }
  }
}
