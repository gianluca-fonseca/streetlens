"use client";

/**
 * The recording HUD, and the paused state that replaces it on backgrounding.
 *
 * Sits over the live camera preview, so per the sealed design it is plates and
 * hairlines, not glass: glass is reserved for live map tiles. The only pink on
 * this screen is the REC dot.
 *
 * The paused state is the honest half of the visibility gate. The camera really
 * did stop, the walker really did keep walking, and resuming really does start a
 * new segment. Saying so is the feature.
 */

import { useTranslations } from "next-intl";
import { CircleStop } from "lucide-react";
import { Action, LiveDot, Notice, Stat } from "@/components/capture/ui";
import { QualityCoachRail } from "@/components/capture/QualityCoachRail";
import { formatDistance, formatElapsed } from "@/components/capture/engine/geo";
import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";
import type { RecorderStats } from "@/components/capture/hooks/useRecorder";
import type { GeolocationState } from "@/components/capture/hooks/useGeolocation";
import type { WakeLockStatus } from "@/components/capture/hooks/useWakeLock";

export function RecordingHUD({
  stats,
  geo,
  wakeLock,
  accuracyWarning,
  durable,
  paused,
  onStop,
  onResume,
}: Readonly<{
  stats: RecorderStats;
  geo: GeolocationState;
  wakeLock: WakeLockStatus;
  accuracyWarning: boolean;
  durable: boolean;
  paused: boolean;
  onStop: () => void;
  onResume: () => void;
}>) {
  const t = useTranslations("collect");

  const gpsValue =
    geo.latest?.accuracy != null
      ? `${Math.round(geo.latest.accuracy)} m`
      : geo.status === "watching"
        ? t("hud.gpsWaiting")
        : "--";

  return (
    <div className="pointer-events-none absolute inset-0 flex min-h-0 flex-col justify-between p-4 pb-safe">
      {/* Status rail */}
      <div className="pointer-events-auto flex flex-col gap-2">
        <div className="flex items-center gap-2 self-start rounded-[2px] border border-border bg-surface-elevated px-2.5 py-1.5">
          <LiveDot live={!paused} />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink">
            {paused ? t("hud.paused") : t("hud.rec")}
          </span>
        </div>

        {geo.reason === "denied" ? <Notice tone="stop">{t("hud.gpsDenied")}</Notice> : null}
        {geo.reason === "unavailable" || geo.reason === "timeout" ? (
          <Notice tone="warn">{t("hud.gpsUnavailable")}</Notice>
        ) : null}
        {accuracyWarning ? (
          <Notice tone="warn">{t("hud.gpsWarn", { meters: CAPTURE_TUNING.accuracyWarnM })}</Notice>
        ) : null}
        {wakeLock === "failed" || wakeLock === "unsupported" ? (
          <Notice tone="warn">{t("hud.wakeFailed")}</Notice>
        ) : null}
        {!durable ? <Notice tone="warn">{t("hud.notDurable")}</Notice> : null}
        <QualityCoachRail
          input={{
            accuracyM: geo.latest?.accuracy ?? stats.accuracyM,
            dropCounts: stats.dropCounts,
            framesKept: stats.framesKept,
            meanGray: stats.meanGray,
            speedMps: stats.speedMps,
          }}
        />
      </div>

      {/* Instrument panel */}
      <div className="pointer-events-auto flex flex-col gap-4">
        {paused ? (
          <div className="rounded-[4px] border border-border bg-surface-elevated p-4">
            <p className="text-[15px] font-semibold text-ink">{t("paused.title")}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-strong">
              {t("paused.body")}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Action variant="accent" onClick={onResume}>
                {t("paused.resume")}
              </Action>
              <Action variant="ghost" onClick={onStop}>
                {t("paused.finish")}
              </Action>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 rounded-[4px] border border-border bg-surface-elevated px-4 py-3">
              <Stat label={t("hud.elapsed")} value={formatElapsed(stats.elapsedMs)} />
              <Stat label={t("hud.frames")} value={stats.framesKept} />
              <Stat label={t("hud.distance")} value={formatDistance(stats.distanceM)} />
              <Stat
                label={t("hud.gps")}
                value={gpsValue}
                tone={accuracyWarning ? "muted" : "ink"}
              />
            </div>
            <Action variant="primary" onClick={onStop}>
              <CircleStop size={18} strokeWidth={1.75} aria-hidden="true" />
              {t("hud.stop")}
            </Action>
          </>
        )}
      </div>
    </div>
  );
}
