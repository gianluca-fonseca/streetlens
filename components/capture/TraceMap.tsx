"use client";

/**
 * The map a contributor draws their walked route on, for a video they already
 * shot.
 *
 * WHY THIS EXISTS. An uploaded video has no GPS track. Something has to say
 * where it went, and the only witness is the person who filmed it. So this is a
 * memory-reconstruction tool, not a data-entry form: click along the streets you
 * walked, watch the router follow them, fix it when it guesses wrong. It is
 * deliberately the whole interaction in one component. The step above it hands
 * in an optional start fix and gets back a path, and that is the entire
 * contract.
 *
 * WHAT IS BORROWED. The MapLibre init and cleanup block is `components/AuditMap.tsx`'s,
 * down to the Liberty style with the demotiles fallback swapped in on the first
 * `error`, the props read through refs so the map never re-inits, and the single
 * `map.remove()` on the way out. The draw interaction is `useTrace`, which
 * explains at length what it took from the manual contribution flow and what it
 * refused. `LIBERTY_STYLE_URL` is duplicated rather than imported because
 * AuditMap keeps it private, which is the same call `TrackMiniMap` made and
 * documented. Copying a URL string is cheaper than exporting a constant out of a
 * component in another flow, purely to satisfy this one.
 *
 * COORDINATE ORDER, THE ONE HAZARD WORTH A PARAGRAPH. MapLibre and the router
 * speak `[lng, lat]` tuples. `lib/capture/route.ts` speaks `{ lat, lng }`
 * objects. Both are correct and they are not interchangeable, and getting it
 * backwards throws no error: it just moves Costa Rica into the Indian Ocean.
 * So the flip lives in exactly TWO named places in this file and nowhere else.
 * `toLatLng` converts on the way OUT to `onPathChange`, and the `center` prop
 * converts on the way IN at map init. Everything between them is `[lng, lat]`,
 * without exception.
 *
 * WHY GLASS IS LEGAL HERE. The sealed design direction allows backdrop-blur over
 * live map tiles only, and forbids it everywhere else in the capture flow (see
 * `components/capture/ui.tsx`). These controls float directly over tiles, which
 * is the sanctioned case, so they use `glassPanel` / `glassChip`. Nothing here
 * uses flash pink: a drawn route is not a signal, a CTA, or an active state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useTranslations } from "next-intl";
import { Route, Trash2, Undo2 } from "lucide-react";
import { useTrace } from "@/components/capture/hooks/useTrace";
import type { Vertex } from "@/components/capture/hooks/useTrace";
import type { LatLng } from "@/lib/capture/route";
import { Notice } from "@/components/capture/ui";
import { cn } from "@/components/ui/cn";
import styles from "@/components/ui/zen.module.css";
import "maplibre-gl/dist/maplibre-gl.css";

// Mirrors the constants in `components/AuditMap.tsx`, which keeps them private.
// Duplicated rather than exported, following `TrackMiniMap`: AuditMap is outside
// this unit's scope and the manual flow stays untouched.
const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

const ESCAZU_CENTER: [number, number] = [-84.138, 9.912];
const INITIAL_ZOOM = 15;
/** Closer than the audit map's default: a route is drawn street by street. */
const CENTERED_ZOOM = 16;

/** The one outbound `[lng, lat]` to `{ lat, lng }` boundary. See the header. */
function toLatLng(path: readonly Vertex[]): LatLng[] {
  return path.map(([lng, lat]) => ({ lat, lng }));
}

/** A control button on the glass rail. Real button, real focus ring, no icon-only mystery. */
function TraceButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: Readonly<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cn(
        styles.controlSoft,
        "inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5",
        "text-[13px] font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-40",
        pressed
          ? "border-ink-display bg-ink-display text-surface"
          : "border-border-strong bg-transparent text-ink hover:bg-surface-sunken",
      )}
    >
      {children}
    </button>
  );
}

export function TraceMap({
  center,
  onPathChange,
  className,
}: Readonly<{
  /**
   * An optional best-effort start fix, used ONLY to centre the map. It may be
   * null (no permission, no fix, a video from another day), and null is not an
   * error: the map falls back to Escazú and the contributor pans.
   */
  center?: Readonly<{ lat: number; lng: number }> | null;
  /** Fires with the routed path, `{ lat, lng }`, whenever the path changes. */
  onPathChange: (path: LatLng[]) => void;
  className?: string;
}>) {
  const t = useTranslations("collect");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // `useTrace` is called BEFORE the map-init effect below on purpose. Effect
  // cleanups run in registration order, so the hook removes its layers while the
  // map is still alive, and only then does `map.remove()` run.
  const trace = useTrace(mapRef, mapReady);
  const { dots, pathCoordinates, followStreets, routing, hasFallback, armed } = trace;

  // Read `center` through a ref so a new object identity from the parent can
  // never re-init the map. It is an initial camera position, not a subscription.
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Same for the callback: it is almost certainly a fresh closure every render,
  // and it has no business being an effect dependency.
  const onPathChangeRef = useRef(onPathChange);
  useEffect(() => {
    onPathChangeRef.current = onPathChange;
  }, [onPathChange]);

  // Create the map exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fix = centerRef.current;
    const map = new maplibregl.Map({
      container,
      style: LIBERTY_STYLE_URL,
      // The inbound half of the coordinate boundary. See the file header.
      center: fix ? [fix.lng, fix.lat] : ESCAZU_CENTER,
      zoom: fix ? CENTERED_ZOOM : INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");

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
      map.resize();
      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Push the path up whenever it changes. `pathCoordinates` only gets a new
  // identity from a recompute, and a recompute only runs from a user edit or the
  // map going ready, so this cannot chase its own tail. The callback is read
  // from a ref, so a parent that re-creates it every render does not re-fire it.
  useEffect(() => {
    onPathChangeRef.current(toLatLng(pathCoordinates));
  }, [pathCoordinates]);

  const toggleArmed = useCallback(() => trace.setArmed(!armed), [trace, armed]);

  const empty = dots.length === 0;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        // MapLibre's canvas is focusable and handles arrow-key pan and +/- zoom
        // itself. The role and label are what make that reachable state legible
        // to a screen reader, since a bare div of tiles announces nothing.
        role="application"
        aria-label={t("videoRoute.mapLabel")}
        className="size-full min-h-[18rem] overflow-hidden rounded-[6px]"
      />

      <div
        className={cn(
          styles.glassPanel,
          "pointer-events-auto absolute inset-x-2 bottom-2 rounded-[6px] p-2",
          "flex flex-wrap items-center gap-2",
        )}
      >
        <TraceButton
          label={armed ? t("videoRoute.finish") : t("videoRoute.draw")}
          onClick={toggleArmed}
          pressed={armed}
        >
          <Route aria-hidden="true" className="size-4" strokeWidth={1.75} />
          <span>{armed ? t("videoRoute.finish") : t("videoRoute.draw")}</span>
        </TraceButton>

        <TraceButton
          label={t("videoRoute.followStreets")}
          onClick={trace.toggleFollowStreets}
          pressed={followStreets}
        >
          <span>{t("videoRoute.followStreets")}</span>
        </TraceButton>

        <TraceButton label={t("videoRoute.undo")} onClick={trace.undo} disabled={empty}>
          <Undo2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </TraceButton>

        <TraceButton label={t("videoRoute.clear")} onClick={trace.clear} disabled={empty}>
          <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </TraceButton>

        <span
          className={cn(
            styles.glassChip,
            "ml-auto rounded-[4px] px-2 py-1",
            "font-mono text-[12px] tabular-nums text-neutral-strong",
          )}
        >
          {t("videoRoute.points", { count: dots.length })}
        </span>

        {routing ? (
          <span
            role="status"
            className="font-mono text-[12px] uppercase tracking-[0.08em] text-ink-muted"
          >
            {t("videoRoute.routing")}
          </span>
        ) : null}
      </div>

      {hasFallback ? (
        <div className="absolute inset-x-2 top-2">
          <Notice tone="warn" title={t("videoRoute.fallbackTitle")}>
            {t("videoRoute.fallbackBody")}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
