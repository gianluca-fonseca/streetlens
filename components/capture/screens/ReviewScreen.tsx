"use client";

/**
 * Review, and the upload that follows it.
 *
 * The walker sees exactly what they produced before deciding to hand it over:
 * the route their phone recorded, how many frames survived, and every frame that
 * did not, with the reason. The dropped-frame table is the point. A walk that
 * kept 8 frames and dropped 300 to "phone had not moved far enough" tells you
 * you left it in your pocket; hiding that would leave the walker to guess.
 *
 * Upload failures land here rather than on a screen of their own, because the
 * frames never left the device and this is where the retry lives.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CAPTURE_LIMITS } from "@/lib/capture/types";
import type { TrackPoint } from "@/lib/capture/types";
import { Action, Eyebrow, Notice, Plate, Screen, Stat } from "@/components/capture/ui";
import { TrackMiniMap } from "@/components/capture/TrackMiniMap";
import { formatDistance, formatElapsed } from "@/components/capture/engine/geo";
import { CAPTURE_TUNING } from "@/components/capture/engine/tuning";
import { DROP_REASONS } from "@/components/capture/engine/gating";
import { totalDropped } from "@/components/capture/engine/session";
import type {
  RecorderStats,
  UploadFailure,
} from "@/components/capture/hooks/useRecorder";
import type { SessionCapReason } from "@/components/capture/engine/gating";
import type { UploadProgress } from "@/lib/capture/upload-client";
import styles from "@/components/ui/zen.module.css";

const INPUT =
  // 16px on phones stops iOS auto-zooming the viewport on focus; the sealed 13px
  // control returns at sm+. Same rule as the contribute form.
  "w-full rounded-[4px] border border-border bg-surface-elevated px-2.5 py-2 text-[16px] text-ink " +
  "placeholder:text-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]";

export function ReviewScreen({
  stats,
  track,
  capReason,
  storageFull,
  uploading,
  uploadProgress,
  uploadFailure,
  onUpload,
  onDiscard,
}: Readonly<{
  stats: RecorderStats;
  track: readonly TrackPoint[];
  capReason: SessionCapReason | null;
  storageFull: boolean;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  uploadFailure: UploadFailure | null;
  onUpload: (contact?: string) => void;
  onDiscard: () => void;
}>) {
  const t = useTranslations("collect");
  const [contact, setContact] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const dropped = totalDropped(stats.dropCounts);
  // The same floor the server enforces: finalize needs a two-fix track, and there
  // is nothing to upload without frames.
  const uploadable = stats.framesKept > 0 && stats.trackPoints >= 2;

  return (
    <Screen>
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("review.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("review.title")}
        </h1>
      </header>

      {capReason === "frame_cap" ? (
        <Notice tone="warn">{t("review.capFrames", { count: CAPTURE_LIMITS.maxFrames })}</Notice>
      ) : null}
      {capReason === "duration_cap" ? (
        <Notice tone="warn">
          {t("review.capDuration", { minutes: Math.round(CAPTURE_TUNING.maxDurationMs / 60_000) })}
        </Notice>
      ) : null}
      {storageFull ? <Notice tone="warn">{t("review.storageFull")}</Notice> : null}

      {uploadFailure ? (
        <Notice tone="stop" title={t(`uploadError.${uploadFailure.kind}_title`)}>
          {t(`uploadError.${uploadFailure.kind}_body`)}
        </Notice>
      ) : null}

      {/* The one place glass is legal on this page: it floats over live map tiles. */}
      {track.length >= 2 ? (
        <figure className="relative h-[220px] overflow-hidden rounded-[4px] border border-border">
          <TrackMiniMap track={track} />
          <figcaption
            className={`${styles.glassChip} absolute left-2 top-2 rounded-[2px] px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink`}
          >
            {t("review.mapLabel")}
          </figcaption>
        </figure>
      ) : null}

      <Plate className="grid grid-cols-2 gap-4 p-4">
        <Stat label={t("review.frames")} value={stats.framesKept} />
        <Stat label={t("review.distance")} value={formatDistance(stats.distanceM)} />
        <Stat label={t("review.duration")} value={formatElapsed(stats.elapsedMs)} />
        <Stat label={t("review.fixes")} value={stats.trackPoints} />
      </Plate>

      <Plate className="p-4">
        <Eyebrow>{t("review.droppedEyebrow")}</Eyebrow>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-strong">
          {t("review.droppedLead")}
        </p>
        {dropped === 0 ? (
          <p className="mt-3 text-[13px] text-ink">{t("review.noneDropped")}</p>
        ) : (
          <dl className="mt-3 flex flex-col gap-1.5">
            {DROP_REASONS.filter((reason) => stats.dropCounts[reason] > 0).map((reason) => (
              <div key={reason} className="flex items-baseline justify-between gap-4">
                <dt className="text-[13px] text-neutral-strong">{t(`drops.${reason}`)}</dt>
                <dd className="font-mono text-[13px] tabular-nums text-ink">
                  {stats.dropCounts[reason]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Plate>

      {uploading ? (
        <Plate className="p-4">
          <p className="text-[13px] font-semibold text-ink">{t("upload.title")}</p>
          <p className="mt-1 font-mono text-[12px] tabular-nums text-neutral-strong">
            {uploadProgress ? t(`upload.${uploadProgress.phase}`) : t("upload.creating_session")}
            {uploadProgress && uploadProgress.total > 0
              ? ` · ${t("upload.progress", {
                  uploaded: uploadProgress.uploaded,
                  total: uploadProgress.total,
                })}`
              : ""}
          </p>
          <p className="mt-2 text-[12px] text-neutral-strong">{t("upload.keepOpen")}</p>
        </Plate>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            // A filled honeypot is a bot. Drop it silently: telling a scraper it
            // was caught only teaches it to fill the field better next time.
            if (honeypot !== "") return;
            onUpload(contact.trim() || undefined);
          }}
        >
          <div>
            <label
              htmlFor="collect-contact"
              className="mb-1 block text-[12px] font-medium text-ink"
            >
              {t("review.contactLabel")}
            </label>
            <input
              id="collect-contact"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              className={INPUT}
            />
            <p className="mt-1 text-[12px] text-neutral-strong">{t("review.contactHint")}</p>
          </div>

          {/* Honeypot. Mirrors the manual contribute flow: off-screen rather than
              display:none, since some bots skip undisplayed fields. */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]">
            <label htmlFor="collect-website">Website</label>
            <input
              id="collect-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-neutral-strong">{t("review.consent")}</p>

          {!uploadable ? <Notice tone="warn">{t("review.tooShort")}</Notice> : null}

          <div className="flex flex-col gap-2">
            <Action variant="accent" type="submit" disabled={!uploadable}>
              {uploadFailure ? t("uploadError.retry") : t("review.upload")}
            </Action>
            <Action
              variant="ghost"
              onClick={() => {
                if (window.confirm(t("review.discardConfirm"))) onDiscard();
              }}
            >
              {t("review.discard")}
            </Action>
          </div>
        </form>
      )}
    </Screen>
  );
}
