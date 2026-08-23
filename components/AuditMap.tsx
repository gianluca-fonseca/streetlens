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
import type { SchoolCollection, SchoolProperties } from "@/lib/schools";
import type { SchoolZoneCollection, SchoolZoneWire } from "@/lib/school-map";
import {
  BASEMAP,
  COMMUNITY_CASING,
  COMMUNITY_LAYER_FILTER,
  RAMP_LAYER_FILTER,
  SCHOOL_GAP_CASING,
  schoolGapWidthExpression,
  SCHOOL_PIN,
  SCHOOL_ZONE_PAINT,
  communityWidthExpression,
  lineColorExpression,
  lineWidthExpression,
  schoolFillExpression,
  schoolRadiusExpression,
  schoolRingExpression,
  schoolRingWidthExpression,
  zonePulse,
} from "@/components/mapConfig";
import type { RampTheme } from "@/components/mapConfig";
import {
  RELIEF_LAYER_ID,
  RELIEF_SOURCE_ID,
  buildReliefCollection,
  reliefHeightExpression,
} from "@/components/scoreRelief";
import { writeMapReliefPreference } from "@/lib/map-relief";
import { readSchoolsOverlay, writeSchoolsOverlay } from "@/lib/schools-overlay";
import { parseFeatureProps } from "@/lib/parse-feature-props";
import { useTheme } from "@/components/ThemeProvider";
import { readStoredPreference, resolveTheme } from "@/lib/theme";
import MapPanel from "@/components/MapPanel";
import ThreeDToggle from "@/components/ThreeDToggle";
import SegmentDetail from "@/components/SegmentDetail";
import SchoolDetail from "@/components/SchoolDetail";
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
const SCHOOLS_SOURCE_ID = "schools";
const SCHOOLS_LAYER_ID = "schools-pin";
const SCHOOLS_LABEL_LAYER_ID = "schools-label";
const ZONES_SOURCE_ID = "school-zones";
const ZONE_FILL_LAYER_ID = "school-zone-fill";
const ZONE_LINE_LAYER_ID = "school-zone-line";
/** The capture backlog, drawn from the segments source by id filter. */
const GAP_LAYER_ID = "school-gaps";
/** Layers that respond to hover / click (score ramp + neutral community casing). */
const INTERACTIVE_LAYER_IDS = [LINE_LAYER_ID, COMMUNITY_LAYER_ID];
/**
 * What a click on `/map` may land on. The relief volume is the street's visible
 * body whenever the dimensional view is on, so it selects the same segment the
 * flat line under it does — reaching the thin base line must never be the price
 * of opening a report card. A hidden layer is skipped by MapLibre's own hit
 * testing, so with the relief off this collapses back to the 2D pair.
 */
const APP_SELECT_LAYER_IDS = [
  LINE_LAYER_ID,
  COMMUNITY_LAYER_ID,
  RELIEF_LAYER_ID,
];

/**
 * The app's RESOLVED theme right now, read straight from the theme store's own
 * resolver — never from a raw `prefers-color-scheme` query.
 *
 * That raw query was the bug (#27): the map asked the OS directly, so toggling
 * the in-app switcher to light on a dark Mac left the whole instrument painted
 * dark. `resolveTheme(readStoredPreference())` is the same computation
 * lib/theme.ts's pre-paint init script and ThemeProvider both perform, so the
 * map agrees with the `.light`/`.dark` class already on <html> — including the
 * "system" case, which still follows the OS, just through the store rather than
 * around it.
 *
 * Used only where React's render value is not reachable or not yet settled (the
 * once-created map effect and the fallback-style handler). Everywhere else the
 * component uses the reactive `resolved` from useTheme(), which re-renders on a
 * switcher toggle AND on a live OS flip while the preference is "system".
 */
function resolvedDark(): boolean {
  return resolveTheme(readStoredPreference()) === "dark";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Hero camera signature (landing-dimensional): the establishing move. First
 * paint is a flat overhead survey; the camera then eases down into a pitched,
 * gently rotated frame over the settling score relief — the city resolving
 * into an instrument — and STOPS. It never drifts under a presenter: one move,
 * one settle. Under prefers-reduced-motion (or with the fly disabled) the map
 * jumps straight to the settled pitched frame, so the relief is still there,
 * minus the motion.
 */
type HeroCamera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};
const HERO_START: HeroCamera = {
  center: [-84.15, 9.9],
  zoom: 13.0,
  bearing: 8,
  pitch: 0,
};
const HERO_END: HeroCamera = {
  center: [-84.146, 9.907],
  zoom: 13.95,
  bearing: -15,
  pitch: 55,
};
/*
 * The establishing move stays, but it settles sooner.
 *
 * It used to be 650ms of hold plus a 3000ms fly, landing 4.73s after navigation
 * start once the ~1.07s style load is counted. Nothing is wrong with that in a
 * vacuum, and the slow glide is the point. The problem is the room: a presenter
 * opening this page live is TALKING over those five seconds, and the frame they
 * are talking about is not there yet. That is the one cost a cinematic opening
 * cannot be allowed to have.
 *
 * 300 + 2400 settles at ~3.77s, a fifth off, and the move keeps its character:
 * the hold is still long enough that the flat overhead survey registers as its
 * own frame before the camera commits, and 2.4s at curve 1.35 is still a glide
 * rather than a cut. Performance was never the constraint (the page measures
 * ~1ms/frame at p99 and goes quiet once settled); attention was.
 */
const HERO_FLY_DELAY_MS = 300;
const HERO_FLY_DURATION_MS = 2400;

/**
 * `/map` camera signature — the same establishing idea as the hero, retuned for
 * something people READ rather than watch.
 *
 * Three deliberate differences from HERO_START/HERO_END, all in the same
 * direction (less cinema, more instrument):
 *
 *  • BEARING STAYS 0. The hero can afford a -15° rotation because it is a
 *    picture. On the instrument, north-up is orientation the reader gets for
 *    free, and spending it buys nothing they can use.
 *  • PITCH 45, NOT 55. Height has to stay readable without swallowing the
 *    network behind it, and the trade is monotone: every degree of pitch buys
 *    apparent height and costs visible ground plan. Measured at 390x844 and at
 *    1440x900, 55° compresses the far half of the canton into roughly the top
 *    quarter of the canvas and stacks distant streets behind the tall
 *    (well-scoring) ones; 45° keeps the ground plan legible while the tallest
 *    bars still stand clearly off it. 45 is also comfortably inside the 60°
 *    coarse-pointer cap, so phones get the identical frame rather than a
 *    clamped one.
 *  • THE CENTRE AND SETTLED ZOOM ARE THE MAP'S OWN. ESCAZU_CENTER at
 *    INITIAL_ZOOM is the framing the flat map already opens on, so turning the
 *    relief off returns the reader to exactly where they were, not to a
 *    different place. Only the pitch and half a zoom step move.
 *
 * The move resolves from a flatter overview into that settled frame and STOPS.
 * A tool that keeps drifting under the reader cannot be read.
 */
const MAP_RELIEF_START = { zoom: 12.9, pitch: 0 };
const MAP_RELIEF_END = { zoom: INITIAL_ZOOM, pitch: 45 };
/**
 * Shorter than the hero's 300 + 2400. The landing page is asking for five
 * seconds of attention and earning them; `/map` was opened to answer a
 * question, so the opening move should establish the third axis and get out of
 * the way. 250 + 1800 still reads as one continuous settle rather than a cut.
 */
const MAP_RELIEF_FLY_DELAY_MS = 250;
const MAP_RELIEF_FLY_DURATION_MS = 1800;

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

function addDataLayers(
  map: maplibregl.Map,
  data: SegmentCollection,
  theme: RampTheme,
) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data,
      promoteId: "id",
    });
  }

  const color = lineColorExpression("overall", theme);
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
  // Added BEFORE the score line so the draw order runs glow → neutral → ramp.
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

/* ------------------------------------------------------------------ *
 * The schools overlay (the "Escuela Segura" view).
 *
 * Added LAST, so the pins sit on top of the score lines and on top of the
 * relief volumes. That order is the argument: a school pin is a place, and the
 * scored street it lands on is the thing being judged around it, so the pin has
 * to stay findable while the network under it changes lens, theme, and height.
 *
 * The layers are always CREATED and toggled by `visibility`, matching the relief
 * layer's contract — the delegated click and hover listeners bind once to an id
 * that always exists, and flipping the overlay costs nothing but a layout
 * property. MapLibre neither draws nor hit-tests an invisible layer, so an
 * overlay that is off cannot steal a click from the street beneath it.
 * ------------------------------------------------------------------ */

/*
 * The zone rings and the capture backlog.
 *
 * Added BEFORE the school pins so the stack reads bottom-up as: scored streets,
 * the zone wash, the backlog, then the pin. The pin has to stay on top — it is
 * the thing a reader aims at — and the backlog has to sit above the score ramp,
 * because a street nobody has recorded is not a low score and must not be
 * readable as one.
 *
 * The gap layer draws from the SEGMENTS source by id filter rather than from a
 * source of its own. The geometry is already on the page; shipping it twice
 * would double the heaviest payload the map loads to say something an id list
 * already says.
 */
function addZoneLayers(
  map: maplibregl.Map,
  data: SchoolZoneCollection,
  theme: RampTheme,
  visible: boolean,
) {
  if (!data.zones.length) return;
  const pal = SCHOOL_ZONE_PAINT[theme];
  const vis = visible ? "visible" : "none";

  if (!map.getSource(ZONES_SOURCE_ID)) {
    map.addSource(ZONES_SOURCE_ID, {
      type: "geojson",
      data: data.rings as GeoJSON.FeatureCollection,
    });
  }

  if (!map.getLayer(ZONE_FILL_LAYER_ID)) {
    map.addLayer({
      id: ZONE_FILL_LAYER_ID,
      type: "fill",
      source: ZONES_SOURCE_ID,
      // Only the walk ring is washed. Filling the gate ring as well would double
      // the tint at the centre of every zone and read as a hotspot, which is the
      // opposite of what a small radius means.
      filter: ["==", ["get", "ring"], "walk"],
      layout: { visibility: vis },
      paint: { "fill-color": pal.ringFill },
    });
  }

  if (!map.getLayer(ZONE_LINE_LAYER_ID)) {
    map.addLayer({
      id: ZONE_LINE_LAYER_ID,
      type: "line",
      source: ZONES_SOURCE_ID,
      layout: { visibility: vis, "line-join": "round" },
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "ring"], "gate"],
          pal.gateRing,
          pal.ring,
        ] as unknown as ExpressionSpecification,
        "line-width": [
          "case",
          ["==", ["get", "ring"], "gate"],
          1,
          1.6,
        ] as unknown as ExpressionSpecification,
        // The gate ring is dashed and quiet; the walk ring is the one that
        // pulses, because it is the boundary the score is actually about.
        "line-dasharray": [
          "case",
          ["==", ["get", "ring"], "gate"],
          ["literal", [2, 2]],
          ["literal", [1, 0]],
        ] as unknown as ExpressionSpecification,
        "line-opacity": 0.6,
      },
    });
  }

  if (!map.getLayer(GAP_LAYER_ID)) {
    map.addLayer({
      id: GAP_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: gapFilter(data.all_gap_ids),
      layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": pal.gap,
        "line-width": schoolGapWidthExpression,
        "line-dasharray": SCHOOL_GAP_CASING.dash,
        "line-opacity": 0.9,
      },
    });
  }
}

/** Draw only the segments nobody has recorded yet. */
function gapFilter(ids: string[]): ExpressionSpecification {
  return ["in", ["get", "id"], ["literal", ids]] as unknown as ExpressionSpecification;
}

/** Re-ink the zone marks for the basemap now under them. */
function applyZoneTheme(map: maplibregl.Map, theme: RampTheme) {
  if (!map.getLayer(ZONE_LINE_LAYER_ID)) return;
  const pal = SCHOOL_ZONE_PAINT[theme];
  try {
    map.setPaintProperty(ZONE_FILL_LAYER_ID, "fill-color", pal.ringFill);
    map.setPaintProperty(
      ZONE_LINE_LAYER_ID,
      "line-color",
      ["case", ["==", ["get", "ring"], "gate"], pal.gateRing, pal.ring] as unknown as ExpressionSpecification,
    );
    map.setPaintProperty(GAP_LAYER_ID, "line-color", pal.gap);
  } catch {
    /* not ready */
  }
}

function applyZonesVisible(map: maplibregl.Map, on: boolean) {
  for (const id of [ZONE_FILL_LAYER_ID, ZONE_LINE_LAYER_ID, GAP_LAYER_ID]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }
}

function addSchoolLayers(
  map: maplibregl.Map,
  data: SchoolCollection,
  theme: RampTheme,
  visible: boolean,
) {
  if (!data.features.length) return;
  const pin = SCHOOL_PIN[theme];

  if (!map.getSource(SCHOOLS_SOURCE_ID)) {
    map.addSource(SCHOOLS_SOURCE_ID, {
      type: "geojson",
      data: data as unknown as GeoJSON.FeatureCollection,
      promoteId: "id",
    });
  }

  if (!map.getLayer(SCHOOLS_LAYER_ID)) {
    map.addLayer({
      id: SCHOOLS_LAYER_ID,
      type: "circle",
      source: SCHOOLS_SOURCE_ID,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "circle-radius": schoolRadiusExpression,
        "circle-color": schoolFillExpression(theme),
        "circle-stroke-color": schoolRingExpression(theme),
        "circle-stroke-width": schoolRingWidthExpression,
        "circle-opacity": 1,
      },
    });
  }

  // Names arrive only once the reader is close enough for a name to be an
  // answer rather than clutter. Below that zoom the pins are a distribution,
  // which is the reading the canton-wide frame is for.
  if (!map.getLayer(SCHOOLS_LABEL_LAYER_ID)) {
    map.addLayer({
      id: SCHOOLS_LABEL_LAYER_ID,
      type: "symbol",
      source: SCHOOLS_SOURCE_ID,
      minzoom: 14.2,
      layout: {
        visibility: visible ? "visible" : "none",
        "text-field": ["get", "display_name"],
        // Pinned to a stack the basemap actually serves. MapLibre's default is
        // ["Open Sans Regular","Arial Unicode MS Regular"], which OpenFreeMap's
        // Liberty glyph endpoint 404s — the labels silently never draw and the
        // console fills with failed glyph ranges. Liberty serves Noto Sans in
        // Regular / Bold / Italic; bold is what separates a school name from the
        // street names it sits among.
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 9,
        // A label that cannot be placed is dropped rather than moved: a school
        // name floating away from its pin is worse than no name.
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": pin.label,
        "text-halo-color": pin.labelHalo,
        "text-halo-width": 1.4,
      },
    });
  }
}

/** Re-ink the pins and their labels for the basemap now under them. */
function applySchoolTheme(map: maplibregl.Map, theme: RampTheme) {
  if (!map.getLayer(SCHOOLS_LAYER_ID)) return;
  const pin = SCHOOL_PIN[theme];
  try {
    map.setPaintProperty(SCHOOLS_LAYER_ID, "circle-color", schoolFillExpression(theme));
    map.setPaintProperty(
      SCHOOLS_LAYER_ID,
      "circle-stroke-color",
      schoolRingExpression(theme),
    );
    map.setPaintProperty(SCHOOLS_LABEL_LAYER_ID, "text-color", pin.label);
    map.setPaintProperty(SCHOOLS_LABEL_LAYER_ID, "text-halo-color", pin.labelHalo);
  } catch {
    /* layers not ready yet */
  }
}

/** Show or hide the overlay. Both layers move together — a floating school name
 *  over hidden pins is not a state this map has. */
function applySchoolsVisible(map: maplibregl.Map, on: boolean) {
  for (const id of [SCHOOLS_LAYER_ID, SCHOOLS_LABEL_LAYER_ID]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }
}

/**
 * maplibre serializes non-primitive feature properties to JSON strings at the
 * worker boundary, so `programmes` arrives as a string. Same hazard
 * lib/parse-feature-props.ts exists for on the segment side, and the same
 * contract: never throw, degrade to an empty list.
 */
function parseSchoolProps(raw: Record<string, unknown> | null | undefined): SchoolProperties {
  const p = (raw ?? {}) as Record<string, unknown>;
  let programmes = p.programmes;
  if (typeof programmes === "string") {
    try {
      programmes = JSON.parse(programmes);
    } catch {
      programmes = [];
    }
  }
  return {
    ...(p as unknown as SchoolProperties),
    programmes: Array.isArray(programmes) ? programmes : [],
  };
}

/**
 * The extruded score relief (see scoreRelief.ts for the contract). Added on TOP
 * of the layer stack so each volume owns its footprint; the flat 2D ramp lines
 * stay underneath as the ground plan and as the whole story wherever nothing is
 * extruded (real-data era, unaudited casings).
 *
 * Shared by the hero and `/map`. `visible` is what makes it shareable: the
 * layer is always CREATED, and the "3D view" control flips its visibility
 * rather than adding and removing it. That keeps the delegated click/hover
 * listeners bound to a layer id that always exists, makes toggling instant
 * (no re-extrusion, no source re-upload), and costs nothing when off, because
 * MapLibre neither draws nor hit-tests an invisible layer. Building the
 * corridor collection for ~1.5k segments is a few milliseconds, so paying it
 * once up front is cheaper than a stutter on the first toggle.
 */
function addReliefLayer(
  map: maplibregl.Map,
  data: SegmentCollection,
  layer: ScoreLayer,
  theme: RampTheme,
  visible: boolean,
) {
  if (!map.getSource(RELIEF_SOURCE_ID)) {
    map.addSource(RELIEF_SOURCE_ID, {
      type: "geojson",
      data: buildReliefCollection(data),
      // Mirrors the segment source, so one segment id addresses its line AND
      // its volume and `setSegmentState` can light both from a single hover.
      promoteId: "id",
    });
  }
  if (!map.getLayer(RELIEF_LAYER_ID)) {
    map.addLayer({
      id: RELIEF_LAYER_ID,
      type: "fill-extrusion",
      source: RELIEF_SOURCE_ID,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        // The SAME ramp as the 2D lines, on the same lens and the same
        // basemap — one encoding, three axes: colour, width, and now height,
        // all agreeing that more presence means a better score.
        "fill-extrusion-color": lineColorExpression(layer, theme),
        "fill-extrusion-height": reliefHeightExpression(layer),
        "fill-extrusion-base": 0,
        // CONSTANT, and it has to be. The 2D layers above express selection as
        // a `line-opacity` feature-state case, but `fill-extrusion-opacity` is
        // not a data-driven property in MapLibre: handing it an expression does
        // not degrade, it makes the style validator REJECT THE WHOLE LAYER, and
        // because addLayer reports that through the map's `error` event rather
        // than throwing, the relief simply never appears and nothing says why.
        //
        // The selection affordance is not lost: hover and selected state are
        // still mirrored onto this source (setSegmentState), so a pointer that
        // lands on the volume lights the street's flat casing underneath it,
        // and the state survives the era flip. Height and colour stay purely
        // the score, which is the encoding this layer exists to carry.
        "fill-extrusion-opacity": 0.92,
      },
    });
  }
}

/**
 * Set a feature state on the segment source AND its relief mirror, so hover and
 * selection read the same on the flat line and on the volume standing over it.
 * Guarded per source: the relief mirror is absent until the layer is created,
 * and `setFeatureState` on a missing source throws.
 */
function setSegmentState(
  map: maplibregl.Map,
  id: string,
  state: Record<string, boolean>,
) {
  for (const source of [SOURCE_ID, RELIEF_SOURCE_ID]) {
    if (!map.getSource(source)) continue;
    try {
      map.setFeatureState({ source, id }, state);
    } catch {
      /* source present but not yet parsed; the next paint re-applies */
    }
  }
}

/** What a resolved click carries: the segment's real properties and its real
 *  LineString, wherever the pointer actually landed. */
type SegmentHit = {
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
};

/**
 * Decide which segment a click meant, given everything under the pointer.
 *
 * A click over an extruded street returns BOTH the relief volume and the flat
 * line beneath it. The volume wins, because it is the thing the reader can see
 * and aimed at; without this rule, clicking the visible body of a tall street
 * could select whatever thin line happened to be reported first.
 *
 * The relief's own properties are only an id and the five scores, so the hit is
 * resolved back to the real segment feature in the live collection: the detail
 * panel gets the same rubric answers, field notes and geometry it gets from a
 * 2D click, and the relief needs no second copy of the payload to stay correct.
 * A volume with no matching segment (mid-era-flip, for one frame) resolves to
 * nothing rather than to a half-populated panel.
 */
/** Drop the selected casing, wherever the selection came from. */
function clearSelectedCasing(map: maplibregl.Map, id: string | null) {
  if (id) setSegmentState(map, id, { selected: false });
}

function resolveSegmentHit(
  features: maplibregl.MapGeoJSONFeature[] | undefined,
  segments: SegmentCollection,
): SegmentHit | null {
  if (!features?.length) return null;
  const volume = features.find((f) => f.layer.id === RELIEF_LAYER_ID);
  if (volume) {
    const id = String(volume.id ?? (volume.properties as { id?: string }).id);
    const segment = segments.features.find((f) => f.properties.id === id);
    return segment
      ? { properties: segment.properties as unknown as Record<string, unknown>, geometry: segment.geometry }
      : null;
  }
  const flat = features[0];
  return { properties: flat.properties, geometry: flat.geometry };
}

/** Repaint the data layers for a score layer; glow is data-only + dark-only. */
function applyLayer(map: maplibregl.Map, layer: ScoreLayer, dark: boolean) {
  const theme: RampTheme = dark ? "dark" : "light";
  const color = lineColorExpression(layer, theme);
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
  } catch {
    /* layers not ready yet */
  }
  // The relief is repainted in the SAME call as the lines, so the lens switcher
  // and the theme can never leave the volumes describing one thing while the
  // ground plan under them describes another. Height moves with colour for the
  // same reason: on `/map` "drainage" has to mean drainage on every channel.
  if (map.getLayer(RELIEF_LAYER_ID)) {
    try {
      map.setPaintProperty(RELIEF_LAYER_ID, "fill-extrusion-color", color);
      map.setPaintProperty(
        RELIEF_LAYER_ID,
        "fill-extrusion-height",
        reliefHeightExpression(layer),
      );
    } catch {
      /* not ready */
    }
  }
}

/* ------------------------------------------------------------------ *
 * The dimensional view — ONE control, ONE meaning.
 *
 * "3D view" on `/map` means the SCORE RELIEF: the network's own quality
 * standing up off the plan, over a pitched camera. It used to mean something
 * else entirely (DEM terrain + hillshade + OSM building extrusions, u8), and
 * the two could not both keep the name.
 *
 * The relief won the label, and the terrain mode was retired rather than folded
 * in, for three reasons that all point the same way:
 *
 *  1. ONE OF THEM CARRIES DATA. The relief IS the score, on a third axis, using
 *     the same sealed ramp as the lines. Hillshade and building boxes are
 *     scenery: they add no information this instrument exists to convey, and on
 *     a pitched frame the building volumes compete with the score volumes for
 *     exactly the reading the page is for.
 *  2. THE RELIEF IS NOW THE DEFAULT VIEW, and folding terrain in would put a
 *     third-party DEM fetch (an S3 bucket with no SLA) on the default path of
 *     the product's main page, for every visitor, on every first load.
 *  3. IT TAKES A WHOLE BUG CLASS WITH IT. With no terrain there is no center
 *     altitude to lose, so the "zoom-in blanks the map in 3D" failure that
 *     `clampCenterToTerrain` existed to paper over cannot occur.
 *
 * What is left is presentational in the same narrow sense u8 claimed: this
 * toggle changes no data and no scores, it only decides whether the score is
 * drawn as height as well as colour and width.
 * ------------------------------------------------------------------ */

/**
 * Show or hide the dimensional view: the relief volumes plus the pitched
 * camera, which move together because either alone is incoherent (a pitched
 * empty plan, or volumes viewed from straight overhead).
 *
 * Off returns the reader to the flat map's own framing — same centre, same
 * zoom, north up — so turning it off is a return rather than a relocation.
 */
function applyReliefView(map: maplibregl.Map, on: boolean) {
  if (map.getLayer(RELIEF_LAYER_ID)) {
    map.setLayoutProperty(RELIEF_LAYER_ID, "visibility", on ? "visible" : "none");
  }
  if (prefersReducedMotion()) {
    map.jumpTo({ pitch: on ? MAP_RELIEF_END.pitch : 0, bearing: on ? map.getBearing() : 0 });
    return;
  }
  map.easeTo({
    pitch: on ? MAP_RELIEF_END.pitch : 0,
    bearing: on ? map.getBearing() : 0,
    duration: 700,
    essential: true,
  });
}

export type AuditMapVariant = "app" | "hero";

export default function AuditMap({
  segments,
  schools,
  schoolZones,
  stats,
  variant = "app",
  activeLayer: controlledLayer,
  flyOnLoad = false,
  interactive = false,
  onSegmentActivate,
  onMoveStateChange,
  openContributeOnMount = false,
  initialSegmentId,
  reliefEnabled = false,
  reliefAnimate = false,
}: Readonly<{
  segments: SegmentCollection;
  /** The canton's schools. Absent on the hero, which is a backdrop, not an
   *  instrument — a pin nobody can click is decoration. */
  schools?: SchoolCollection;
  /** Zone rings, per-school readings, and the capture backlog. */
  schoolZones?: SchoolZoneCollection;
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
  /** Deep-link from landing CTA: open the contribute chooser once the map is ready. */
  openContributeOnMount?: boolean;
  /** Deep-link: focus and open the detail panel for this segment id on load. */
  initialSegmentId?: string;
  /** App surface: open in the extruded dimensional view. Resolved on the SERVER
   *  from the `sl_map_relief` cookie so the control's first paint is already the
   *  truth (see lib/map-relief.ts). The hero manages its relief itself. */
  reliefEnabled?: boolean;
  /** App surface: this visitor has not seen the establishing move yet, so play
   *  it once. ANDed with the client's own `prefers-reduced-motion` check. */
  reliefAnimate?: boolean;
}>) {
  const t = useTranslations("map");
  // The instrument follows the APP theme (#27), not the OS. `resolved` collapses
  // the light/dark/system preference to the concrete theme currently rendering,
  // and re-renders this component the moment the switcher flips — or, while the
  // preference is "system", when the OS itself flips.
  const { resolved } = useTheme();
  const dark = resolved === "dark";
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
  // Seeded from the server-resolved cookie, so the toggle's very first render —
  // the one in the HTML, before any JS runs — already matches what the map is
  // about to do. No default-then-correct flicker, and no hydration mismatch.
  const [relief, setRelief] = useState(reliefEnabled);
  // The overlay's default is ON (see lib/schools-overlay.ts). The stored
  // preference is read after mount, because localStorage is not available while
  // this renders on the server.
  const [schoolsOn, setSchoolsOn] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState<SchoolProperties | null>(null);
  const [selectedZone, setSelectedZone] = useState<SchoolZoneWire | null>(null);
  // Transient cooperative-gesture hint (shown on a raw wheel over the hero map).
  const [wheelHint, setWheelHint] = useState(false);
  // App surface only: true while the map is panning/zooming so the over-tile chrome
  // (MapPanel / SegmentDetail popover / contribute panels / zoom controls) drops its
  // glass to a solid during the move — the costly re-blur-per-frame path (u18-A3).
  const [mapMoving, setMapMoving] = useState(false);

  // Map-integrated contribution flow (owns its own draw layers + handlers).
  const contribute = useContribute(mapRef, mapReady);
  const openedContributeRef = useRef(false);

  useEffect(() => {
    if (!openContributeOnMount || !mapReady || openedContributeRef.current) return;
    openedContributeRef.current = true;
    contribute.open();
  }, [openContributeOnMount, mapReady, contribute]);

  const activeLayerRef = useRef(activeLayer);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const segmentsRef = useRef(segments);
  const schoolsRef = useRef(schools);
  const zonesRef = useRef(schoolZones);
  const schoolsOnRef = useRef(schoolsOn);
  // The collection currently drawn by the source, so a re-render that did not
  // change the data never re-sets it (setData drops feature-state, which is what
  // carries the selected and hovered casings).
  const paintedSegmentsRef = useRef<SegmentCollection | null>(null);
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
  const initialSegmentRef = useRef(initialSegmentId);
  const focusedSegmentRef = useRef(false);
  // Read once, inside the create-the-map-once effect, like every other variant
  // flag here. Both are server-resolved and fixed for the life of the mount.
  const reliefEnabledRef = useRef(reliefEnabled);
  const reliefAnimateRef = useRef(reliefAnimate);
  useEffect(() => {
    activeLayerRef.current = activeLayer;
    segmentsRef.current = segments;
    schoolsRef.current = schools;
    zonesRef.current = schoolZones;
    schoolsOnRef.current = schoolsOn;
    contributeRef.current = contribute;
    isHeroRef.current = isHero;
    flyOnLoadRef.current = flyOnLoad;
    interactiveRef.current = heroInteractive;
    onActivateRef.current = onSegmentActivate;
    onMoveRef.current = onMoveStateChange;
    initialSegmentRef.current = initialSegmentId;
  });

  useEffect(() => {
    const segmentId = initialSegmentRef.current;
    const map = mapRef.current;
    if (!segmentId || !mapReady || !map || !readyRef.current || focusedSegmentRef.current) {
      return;
    }
    const feature = segmentsRef.current.features.find((f) => f.properties.id === segmentId);
    if (!feature) return;
    focusedSegmentRef.current = true;
    const props = parseFeatureProps(feature.properties);
    selectFeature(map, props, feature.geometry);
    setSelected(props);
  }, [mapReady, segments, initialSegmentId]);

  // Create the map exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hero = isHeroRef.current;
    const heroLive = hero && interactiveRef.current;
    // Cap pitch on touch / narrow viewports (research: mobile ≈60°, desktop
    // 70°). Both settled cameras clear it: the hero's HERO_END.pitch is 55 and
    // the map's MAP_RELIEF_END.pitch is 45, so a phone gets the frame the
    // desktop gets rather than a clamped one.
    const coarsePointer =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640;
    const maxPitch = coarsePointer ? 60 : 70;

    // App surface: does this visitor get the relief, and do they get the move?
    // The server already decided both from the cookie; the client's only
    // addition is reduced motion, which the server cannot see.
    const reliefOn = !hero && reliefEnabledRef.current;
    const reliefMoves = reliefOn && reliefAnimateRef.current && !prefersReducedMotion();

    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      center: hero ? HERO_START.center : ESCAZU_CENTER,
      // A returning visitor (and anyone on reduced motion) opens ON the settled
      // frame rather than being placed at the start of a move that will not
      // play. Only the animating first arrival starts from the flat overview.
      zoom: hero
        ? HERO_START.zoom
        : reliefMoves
          ? MAP_RELIEF_START.zoom
          : reliefOn
            ? MAP_RELIEF_END.zoom
            : INITIAL_ZOOM,
      pitch: !hero && reliefOn && !reliefMoves ? MAP_RELIEF_END.pitch : 0,
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
    // control; visualizePitch renders the rotate/pitch dial, which now earns its
    // place — the map's default view is pitched, so the dial is both a live
    // readout of the tilt and the way back to north-up.
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
      // Read the store directly rather than the render closure: this effect runs
      // once, and on the very first pass the theme store may not have published
      // its snapshot yet. resolvedDark() is authoritative at call time, so the
      // map's first paint is already the right theme (no dark flash then correct).
      const dark = resolvedDark();
      muteBasemap(map, dark);
      addDataLayers(map, segmentsRef.current, dark ? "dark" : "light");
      // Both surfaces carry the extruded score relief now. The hero's is always
      // on; the map's is created either way and starts hidden when this visitor
      // has turned it off, so the control can flip it without a rebuild.
      addReliefLayer(
        map,
        segmentsRef.current,
        activeLayerRef.current,
        dark ? "dark" : "light",
        hero || reliefOn,
      );
      if (!hero && zonesRef.current) {
        addZoneLayers(map, zonesRef.current, dark ? "dark" : "light", schoolsOnRef.current);
      }
      // Pins last, so they sit above both the flat ramp and the relief volumes.
      // The hero gets none: it is a backdrop, and its taps open /map wholesale.
      if (!hero && schoolsRef.current) {
        addSchoolLayers(
          map,
          schoolsRef.current,
          dark ? "dark" : "light",
          schoolsOnRef.current,
        );
      }
      paintedSegmentsRef.current = segmentsRef.current;

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
              pitch: HERO_END.pitch,
              duration: HERO_FLY_DURATION_MS,
              curve: 1.35,
              essential: true,
            });
          }, HERO_FLY_DELAY_MS);
        } else {
          map.jumpTo({
            center: HERO_END.center,
            zoom: HERO_END.zoom,
            bearing: HERO_END.bearing,
            pitch: HERO_END.pitch,
          });
        }
      }

      // The map's own establishing move: a flatter overview resolving into the
      // settled pitched frame, once, and then it holds. `easeTo` rather than the
      // hero's `flyTo` because the centre does not move — a flyTo's zoom-out-and-
      // back arc would be motion describing a journey that is not being made.
      if (reliefMoves) {
        window.setTimeout(() => {
          map.easeTo({
            zoom: MAP_RELIEF_END.zoom,
            pitch: MAP_RELIEF_END.pitch,
            duration: MAP_RELIEF_FLY_DURATION_MS,
            essential: true,
          });
        }, MAP_RELIEF_FLY_DELAY_MS);
      }
      // Mark the move as seen the moment the view is established, whether it
      // was animated or jumped to. This is also what writes the preference for
      // a first-time visitor, so a reload opens straight on the settled frame.
      if (reliefOn) writeMapReliefPreference(true);

      // Hover: on the app the relief volume is part of the same street as the
      // line under it, so a hit on either lights BOTH (setSegmentState mirrors
      // the state onto the relief source). The hero keeps the 2D pair only —
      // its relief hover is a plain cursor affordance, further down.
      const hoverLayers = hero ? INTERACTIVE_LAYER_IDS : APP_SELECT_LAYER_IDS;
      map.on("mousemove", hoverLayers, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const id = String(f.id ?? (f.properties as SegmentProperties).id);
        if (hoveredIdRef.current && hoveredIdRef.current !== id) {
          setSegmentState(map, hoveredIdRef.current, { hover: false });
        }
        hoveredIdRef.current = id;
        setSegmentState(map, id, { hover: true });
      });
      map.on("mouseleave", hoverLayers, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredIdRef.current) {
          setSegmentState(map, hoveredIdRef.current, { hover: false });
          hoveredIdRef.current = null;
        }
      });

      // Read-only hero has no selection popover; the app surface keeps it.
      if (!hero) {
        map.on("click", APP_SELECT_LAYER_IDS, (e) => {
          // ONE handler across the flat pair and the relief, rather than a
          // separate relief listener: a click over an extruded street hits the
          // volume AND the line beneath it, and two independent handlers would
          // both fire and race to set the selection. Resolving here makes the
          // winner explicit — the volume is what the reader can actually see,
          // so it wins when it is present.
          // Yield to a school pin under the same point (see the pin handler
          // below). Queried rather than tracked, so the two handlers cannot
          // disagree about what the reader is looking at.
          if (
            map.getLayer(SCHOOLS_LAYER_ID) &&
            map.queryRenderedFeatures(e.point, { layers: [SCHOOLS_LAYER_ID] }).length
          ) {
            return;
          }
          const hit = resolveSegmentHit(e.features, segmentsRef.current);
          if (!hit) return;
          // maplibre serializes community_report/community_reports to JSON
          // strings at the worker boundary; normalize them here so both the ramp
          // and the community casing layer hand SegmentDetail well-formed props.
          const props = parseFeatureProps(hit.properties);
          // Gate for the contribution flow: swallow the click while tracing,
          // and route it to the correction form while picking a segment.
          const contrib = contributeRef.current;
          const cmode = contrib.modeRef.current;
          if (cmode === "trace") return;
          if (cmode === "select") {
            const geom = hit.geometry;
            const coordinates =
              geom.type === "LineString"
                ? (geom.coordinates as [number, number][])
                : [];
            contrib.pickSegment({ id: props.id, name: props.name, coordinates });
            return;
          }
          selectFeature(map, props, hit.geometry);
          setSelected(props);
        });
        // A pin sits ON TOP of the street it belongs to, so a tap over one hits
        // both. The pin wins — it is the mark the reader aimed at — and the
        // segment handler above bails out when it sees one under the point.
        map.on("click", SCHOOLS_LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          if (contributeRef.current.modeRef.current !== "idle") return;
          clearSelectedCasing(map, selectedIdRef.current);
          selectedIdRef.current = null;
          setSelected(null);
          const props = parseSchoolProps(f.properties);
          setSelectedSchool(props);
          setSelectedZone(
            zonesRef.current?.zones.find((z) => z.school_id === props.id) ?? null,
          );
        });
        // The wash is a tap target too: on a phone the ring is a much larger
        // thing to hit than an 8px pin, and it means the same school.
        map.on("click", ZONE_FILL_LAYER_ID, (e) => {
          if (contributeRef.current.modeRef.current !== "idle") return;
          const schoolId = e.features?.[0]?.properties?.school_id;
          if (typeof schoolId !== "string") return;
          const school = schoolsRef.current?.features.find(
            (f) => f.properties.id === schoolId,
          );
          if (!school) return;
          clearSelectedCasing(map, selectedIdRef.current);
          selectedIdRef.current = null;
          setSelected(null);
          setSelectedSchool(school.properties);
          setSelectedZone(
            zonesRef.current?.zones.find((z) => z.school_id === schoolId) ?? null,
          );
        });
        map.on("mousemove", SCHOOLS_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", SCHOOLS_LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
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
        // The relief volumes are the streets' visible bodies in the hero, so
        // they take the same tap-to-open + pointer affordance as the lines.
        map.on("click", RELIEF_LAYER_ID, () => onActivateRef.current?.());
        map.on("mousemove", RELIEF_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", RELIEF_LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("movestart", () => onMoveRef.current?.(true));
        map.on("moveend", () => onMoveRef.current?.(false));
      }
    };
    map.on("load", onLoad);

    // Re-apply muting after a fallback style loads.
    map.on("styledata", () => {
      if (fallbackApplied && map.isStyleLoaded()) {
        muteBasemap(map, resolvedDark());
      }
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-theme the instrument whenever the APP theme resolves differently (#27):
  // the basemap palette. No matchMedia listener of its own any more — that
  // listener was what let the OS override the switcher. A live OS flip still
  // lands here, because while the preference is "system" the theme store
  // re-resolves and re-renders us, which changes `dark`. The relief's own ramp
  // half is re-applied by the applyLayer effect below, which `dark` also drives.
  //
  // `mapReady` is a dependency, not just `dark`: the theme can settle before the
  // style finishes loading, and these calls no-op until the map is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    muteBasemap(map, dark);
  }, [dark, mapReady]);

  // Repaint the data layers when the active score layer — or the theme, which
  // drives the glow — changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyLayer(map, activeLayer, dark);
  }, [activeLayer, dark, mapReady]);

  // The pins carry no score, so only the theme moves them: their ink and their
  // ring are the page's own, and the page just changed which one that is.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySchoolTheme(map, dark ? "dark" : "light");
    applyZoneTheme(map, dark ? "dark" : "light");
  }, [dark, mapReady]);

  // Hydrate the remembered overlay choice. Runs once, after mount, because
  // localStorage does not exist while this component renders on the server.
  useEffect(() => {
    const stored = readSchoolsOverlay();
    if (stored === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage read on mount
    setSchoolsOn(stored);
  }, []);

  /*
   * The zone pulse.
   *
   * One requestAnimationFrame driver for every ring rather than one per school:
   * thirty-three independent timers would drift out of phase within seconds and
   * turn a slow heartbeat into visual noise. In sync they read as one
   * instrument breathing, which is the intent.
   *
   * Stops entirely when the overlay is off (nothing to animate) and when the
   * reader has asked for reduced motion — a pulsing boundary is decoration to
   * anyone who cannot tolerate movement, and the ring says the same thing
   * standing still.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !schoolsOn) return;
    if (prefersReducedMotion()) {
      if (map.getLayer(ZONE_LINE_LAYER_ID)) {
        map.setPaintProperty(ZONE_LINE_LAYER_ID, "line-opacity", 0.6);
      }
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (map.getLayer(ZONE_LINE_LAYER_ID)) {
        const t = zonePulse(now - started);
        // Shallow on purpose: 0.34 → 0.85 is visible at a glance and invisible
        // once you are reading the streets underneath it.
        map.setPaintProperty(ZONE_LINE_LAYER_ID, "line-opacity", 0.34 + 0.51 * t);
        map.setPaintProperty(ZONE_FILL_LAYER_ID, "fill-opacity", 0.72 + 0.28 * t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [schoolsOn, mapReady]);

  // Overlay visibility, mirrored onto the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySchoolsVisible(map, schoolsOn);
    applyZonesVisible(map, schoolsOn);
  }, [schoolsOn, mapReady]);

  // Push a NEW segment collection into the live source. The map is created once
  // and seeded from a ref, so without this the GeoJSON MapLibre holds is frozen
  // at mount: flipping the demo-data switch re-renders the panel from fresh
  // server props while the drawn network still shows the previous era's scores.
  // The first collection is the one addDataLayers already seeded, so it is
  // recorded rather than re-set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (paintedSegmentsRef.current === segments) return;
    const source = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    paintedSegmentsRef.current = segments;
    source.setData(segments);
    // The relief derives from the same collection, so it flips eras in the same
    // effect — otherwise the volumes would keep the previous era's heights over
    // freshly-swapped lines.
    const reliefSource = map.getSource(RELIEF_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (reliefSource) reliefSource.setData(buildReliefCollection(segments));
    // `setData` clears every feature-state on the source it touches, which is
    // what carries the hovered and selected casings. The era flip is a data
    // swap, not a deselection: the panel stays open on the same street, so its
    // casing has to stay lit under it. Re-assert both, on both sources, for the
    // ids we still consider live.
    if (selectedIdRef.current) {
      setSegmentState(map, selectedIdRef.current, { selected: true });
    }
    if (hoveredIdRef.current) {
      setSegmentState(map, hoveredIdRef.current, { hover: true });
    }
  }, [segments, mapReady]);

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

  /**
   * The one dimensional-view switch. React state and the map move together in
   * the same call, and the choice is persisted immediately, so the control can
   * never claim one thing while the canvas shows another — on this paint, on a
   * reload, or on the next navigation into `/map`.
   */
  const handleToggleRelief = (next: boolean) => {
    setRelief(next);
    writeMapReliefPreference(next);
    const map = mapRef.current;
    if (map && readyRef.current) applyReliefView(map, next);
  };

  /**
   * Turning the overlay off also closes an open school card. It is done here
   * rather than in the visibility effect because it is a consequence of the
   * READER's choice, not of the map's state: the card would otherwise describe
   * a pin they can no longer see, and clicking away from it — the usual way out
   * — would have nothing to click away from.
   */
  const handleToggleSchools = (next: boolean) => {
    setSchoolsOn(next);
    writeSchoolsOverlay(next);
    if (!next) {
      setSelectedSchool(null);
      setSelectedZone(null);
    }
  };

  const handleClose = () => {
    const map = mapRef.current;
    if (map) {
      clearSelectedCasing(map, selectedIdRef.current);
      selectedIdRef.current = null;
    }
    setSelected(null);
  };

  // Outside-tap dismissal: any pointer down outside the open card closes it.
  // Map hits on another segment or another school pin are left to the layer
  // click handlers, so the selection switches without a close-then-reopen
  // flicker. One effect covers both cards because only one is ever open.
  useEffect(() => {
    if (!selected && !selectedSchool) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (
        document.querySelector("[data-segment-detail]")?.contains(target) ||
        document.querySelector("[data-school-detail]")?.contains(target)
      ) {
        return;
      }

      const map = mapRef.current;
      const canvas = map?.getCanvas();
      if (map && canvas && (target === canvas || canvas.contains(target))) {
        const rect = canvas.getBoundingClientRect();
        const point = new maplibregl.Point(
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        // Same layer set the click handler selects from, or a tap on an
        // extruded street would read as "outside" and close the panel a
        // heartbeat before the click reopened it. Filtered to layers that
        // actually exist, because `queryRenderedFeatures` errors on an
        // unknown id and the relief is absent on a fallback style.
        const features = map.queryRenderedFeatures(point, {
          layers: [...APP_SELECT_LAYER_IDS, SCHOOLS_LAYER_ID].filter((id) =>
            map.getLayer(id),
          ),
        });
        if (features.length > 0) return;
      }

      handleClose();
      setSelectedSchool(null);
      setSelectedZone(null);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [selected, selectedSchool]);

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
                path so gating wheel-zoom never blocks the user. 36x36 measured
                on a phone, so they take the 44px tap floor on a coarse pointer;
                they float over the canvas, so nothing reflows around them. */}
            <div className="absolute bottom-3 right-3 z-10 flex flex-col">
              <button
                type="button"
                onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
                aria-label={t("zoomIn")}
                className="sl-glass-chip flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-t-[10px] font-mono text-[19px] leading-none text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
                aria-label={t("zoomOut")}
                className="sl-glass-chip -mt-px flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-b-[10px] font-mono text-[19px] leading-none text-ink transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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

      {/* Top-left control cluster (thumb-reachable, stacked). The column is
          height budgeted: it spans the plate (inset-0, h-full) and reserves the
          bottom band for the contribute button, so the 3D toggle beneath the
          aside can never be pushed under it. The aside itself absorbs the
          overflow (it caps its own height and scrolls). Without the budget the
          Spanish panel already buried the toggle at 1440x800. The reserve is
          the contribute button's own band: taller on phones, where it centres
          on the bottom edge and clears the home bar.

          Re-measured after the contribute button took the 44px coarse-pointer
          tap floor (it was 35.5px). Phones: dock is `bottom-0 p-3`, so the
          button spans 12..56px off the plate bottom and `pb-16` (64px) still
          clears it. At sm+ the dock returns to `sm:bottom-4 sm:p-0`, so on a
          coarse-pointer tablet it spans 16..60px and the old `sm:pb-14` (56px)
          would have been 4px short — hence the sm+ coarse reserve below. A
          fine-pointer desktop keeps 56px exactly, because the button is still
          35.5px there. */}
      <div className="pointer-events-none absolute inset-0 flex items-start gap-3 p-3 pb-16 sm:p-4 sm:pb-14 sm:pointer-coarse:pb-16">
        <div className="pointer-events-none flex h-full flex-col items-start gap-3">
          {stats ? (
            <MapPanel
              stats={stats}
              activeLayer={activeLayer}
              onSelectLayer={setActiveLayer}
              schoolCounts={
                schools?.features.length
                  ? {
                      public: schools.metadata.counts.public,
                      private: schools.metadata.counts.private,
                    }
                  : null
              }
              schoolsOn={schoolsOn}
              onToggleSchools={handleToggleSchools}
            />
          ) : null}
          <ThreeDToggle active={relief} onToggle={handleToggleRelief} />
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
            data-segment-scrim
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

      {/* School card: same bottom-sheet-on-phone / top-right-popover-on-desktop
          placement as the segment detail, because they are the same gesture's
          answer and only one is ever open. */}
      {selectedSchool ? (
        <>
          <button
            type="button"
            onClick={() => {
              setSelectedSchool(null);
              setSelectedZone(null);
            }}
            aria-hidden="true"
            tabIndex={-1}
            data-school-scrim
            className="absolute inset-0 z-20 bg-[rgba(0,0,0,0.32)] md:hidden"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:block md:p-0">
            <SchoolDetail
              key={selectedSchool.id}
              school={selectedSchool}
              zone={selectedZone}
              onClose={() => {
                setSelectedSchool(null);
                setSelectedZone(null);
              }}
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
      setSegmentState(map, selectedIdRef.current, { selected: false });
    }
    selectedIdRef.current = props.id;
    setSegmentState(map, props.id, { selected: true });

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
