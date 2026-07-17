"use client";

/**
 * The step that cannot be skipped: where did this video go.
 *
 * WHY BOTH OPTIONS ARE ON SCREEN AT ONCE. The obvious build is a chooser that
 * swaps in one editor or the other. It is worse for the two reasons that matter
 * here. First, a contributor usually does not know which one applies to them
 * until they see what a GPX step actually wants, and a chooser makes them commit
 * before they can look. Second, the honest fallback for "my watch file will not
 * load" is "draw it instead", and that fallback should be visible from the
 * failure, not two clicks behind it. So the GPX picker and the map are both
 * here, and the choice is made by what you did rather than by what you declared:
 * pick a GPX and the GPX wins, put a point on the map and the drawn line wins.
 * `chosen` is stated in words above the confirm, because an implicit choice that
 * is never spelled out is how you upload the wrong route.
 *
 * WHY A BROKEN GPX IS NOT A SILENT SKIP. `parseGpx` rejects a whole file over one
 * unreadable coordinate, and this screen reports that verbatim rather than
 * salvaging what parsed. Its header explains why at length, and the short version
 * is that a dropped vertex does not announce itself: it just cuts a corner, and
 * the contributor gets a route through a building with nothing to tell them.
 *
 * WHY THE TIMED/UNTIMED DISTINCTION IS SURFACED. A timed GPX keeps its own
 * measured times. An untimed one gets the video's duration spread evenly along
 * it, which assumes a constant pace that the contributor may know is false (they
 * stopped at a light, they walked the hill slowly). They cannot judge that unless
 * we say which one their file got, so we say it, at the point of picking.
 *
 * GLASS. None of this file's chrome is glass. `TraceMap` owns the map and its own
 * over-tile controls, which are the sanctioned case; everything out here is
 * `Plate` plus a hairline.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Action, Eyebrow, Notice, Plate, Screen } from "@/components/capture/ui";
import { TraceMap } from "@/components/capture/TraceMap";
import { gpxErrorKeys } from "@/components/capture/screens/video/error-keys";
import { parseGpx, type GpxPoint } from "@/lib/capture/gpx";
import type { LatLng } from "@/lib/capture/route";
import type { VideoRoute } from "@/components/capture/engine/video-session";

type PickedGpx = { name: string; points: GpxPoint[]; hasTimes: boolean };

export function VideoRouteScreen({
  onConfirm,
  onDiscard,
}: Readonly<{ onConfirm: (route: VideoRoute) => void; onDiscard: () => void }>) {
  const t = useTranslations("collect");
  const [gpx, setGpx] = useState<PickedGpx | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [tracePath, setTracePath] = useState<readonly LatLng[]>([]);
  const [source, setSource] = useState<"gpx" | "trace" | null>(null);

  // `TraceMap` reads this through a ref, so a fresh identity would not re-fire
  // it. Memoised anyway: it is the cheap half of a contract worth not relying on.
  const handlePath = useCallback((path: LatLng[]) => {
    setTracePath(path);
    // An empty path is the map reporting its own mount, not a choice. Only a
    // real point takes the selection away from a GPX the contributor picked.
    if (path.length > 0) setSource("trace");
  }, []);

  const readGpx = async (file: File) => {
    setGpxError(null);
    const result = parseGpx(await file.text());
    if (!result.ok) {
      setGpx(null);
      setGpxError(result.reason);
      if (source === "gpx") setSource(null);
      return;
    }
    setGpx({ name: file.name, points: result.points, hasTimes: result.hasTimes });
    setSource("gpx");
  };

  const confirm = () => {
    if (source === "gpx" && gpx) {
      const path = gpx.points.map(({ lat, lng }) => ({ lat, lng }));
      onConfirm(
        gpx.hasTimes
          ? {
              source: "gpx",
              path,
              // `hasTimes` is all-or-nothing by `parseGpx`'s contract: true means
              // every point carries `t`, so the assertion cannot fire.
              timedTrack: gpx.points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t! })),
            }
          : { source: "gpx", path },
      );
      return;
    }
    if (source === "trace" && tracePath.length >= 2) {
      onConfirm({ source: "trace", path: tracePath.map(({ lat, lng }) => ({ lat, lng })) });
    }
  };

  const ready =
    (source === "gpx" && gpx !== null) || (source === "trace" && tracePath.length >= 2);
  const errorKeys = gpxError ? gpxErrorKeys(gpxError) : null;

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("videoRoute.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("videoRoute.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("videoRoute.lead")}
        </p>
      </header>

      <Plate className="flex flex-col gap-3 p-4">
        <div>
          <Eyebrow>{t("videoRoute.gpxTitle")}</Eyebrow>
          <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-strong">
            {t("videoRoute.gpxBody")}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">{t("videoRoute.gpxPick")}</span>
          <input
            data-testid="gpx-file-input"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readGpx(file);
              // Same rule as the video picker: re-picking the same file after a
              // parse failure has to fire a change event.
              event.target.value = "";
            }}
            className="w-full rounded-[4px] border border-border bg-surface-elevated px-2.5 py-2 text-[16px] text-ink file:mr-3 file:rounded-[2px] file:border file:border-border-strong file:bg-transparent file:px-2 file:py-1 file:text-[12px] file:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]"
          />
        </label>

        {errorKeys ? (
          <Notice tone="stop" title={t(errorKeys.title)}>
            {t(errorKeys.body)}
          </Notice>
        ) : null}

        {gpx ? (
          <>
            <p className="font-mono text-[12px] tabular-nums text-ink">
              {t("videoRoute.gpxPicked", { points: gpx.points.length, name: gpx.name })}
            </p>
            <Notice tone={gpx.hasTimes ? "neutral" : "warn"}>
              {gpx.hasTimes ? t("videoRoute.gpxTimed") : t("videoRoute.gpxUntimed")}
            </Notice>
          </>
        ) : null}
      </Plate>

      <Plate className="flex flex-col gap-3 p-4">
        <div>
          <Eyebrow>{t("videoRoute.traceTitle")}</Eyebrow>
          <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-strong">
            {t("videoRoute.traceBody")}
          </p>
        </div>
        {/* `center` is null on purpose: an uploaded video hands us no start fix,
            and asking for the contributor's CURRENT location to centre a map of a
            walk they took last week would be a permission prompt bought under
            false pretences. The map opens on Escazú and they pan. */}
        <TraceMap center={null} onPathChange={handlePath} className="h-[22rem] w-full" />
        {tracePath.length > 0 && tracePath.length < 2 ? (
          <Notice tone="warn">{t("videoRoute.traceHint")}</Notice>
        ) : null}
      </Plate>

      <div className="flex flex-col gap-2">
        {source ? (
          <p className="text-[12px] text-neutral-strong" role="status">
            {t(`videoRoute.chosen_${source}`)}
          </p>
        ) : null}
        <Action variant="accent" onClick={confirm} disabled={!ready} testId="route-confirm">
          {t("videoRoute.confirm")}
        </Action>
        <Action variant="ghost" onClick={onDiscard}>
          {t("videoRoute.discard")}
        </Action>
      </div>
    </Screen>
  );
}
