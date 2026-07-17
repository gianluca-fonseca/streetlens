"use client";

/**
 * Review, and the upload that follows it, for a video someone already shot.
 *
 * This is `screens/ReviewScreen.tsx` with a different set of facts, and the parts
 * that are the same are the same on purpose rather than by copy-paste inertia:
 * the `INPUT` recipe (16px on phones so iOS does not zoom the viewport on focus,
 * the sealed 13px control back at sm+), the off-screen honeypot (off-screen and
 * not `display:none`, since some bots skip undisplayed fields), the optional
 * contact field, the consent line, the mini-map on tiles with its glass chip, and
 * upload failures landing here rather than on a screen of their own. That last
 * one is the same call for the same reason: the frames never left the device, so
 * this is where the retry lives. The upload progress and failure copy is the
 * EXISTING `upload.*` / `uploadError.*` keys, not a second set: both paths funnel
 * through `uploadCapture` and classify identically, so a second set of strings
 * would be two ways to say one thing and one of them would rot.
 *
 * WHAT IS DIFFERENT, AND WHY. The live review's centrepiece is the dropped-frame
 * table, because a live walk is a negotiation with a GPS gate and the walker
 * needs to see what it refused. Nothing on this path is gated: `engine/gating.ts`
 * never runs, the counters are all zero, and a table of zeroes would be
 * ceremony. What replaces it is the provenance of the route, which is the fact
 * this path has and the live one does not. A GPX with real times and a line drawn
 * from memory produce the same shape of object and are not the same quality of
 * evidence, so the screen says which one this is, and says out loud when the
 * times were assumed rather than measured.
 *
 * THE CLOCK NUDGE IS CONDITIONAL AND THE CONDITION IS LOAD-BEARING. It is
 * rendered only when the route carries its own clock. Where it is hidden, the
 * reason is printed rather than the control being silently absent: the route has
 * no clock of its own, so the frames are already lined up with it. See
 * `ClockNudge.tsx` for the full argument.
 *
 * GLASS. Exactly one element here is glass, and it is the chip over the
 * `TrackMiniMap`'s live tiles. Everything else is `Plate` plus a hairline,
 * including the clock nudge's `<video>` thumbnail, which is a file preview and
 * not tiles.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Action, Eyebrow, Notice, Plate, Screen, Stat } from "@/components/capture/ui";
import { TrackMiniMap } from "@/components/capture/TrackMiniMap";
import { ClockNudge } from "@/components/capture/screens/video/ClockNudge";
import { formatDistance, formatElapsed } from "@/components/capture/engine/geo";
import { pathLengthMeters } from "@/lib/capture/route";
import type { TrackPoint } from "@/lib/capture/types";
import type { UploadProgress } from "@/lib/capture/upload-client";
import type { ExtractionPlan } from "@/components/capture/engine/video-plan";
import type { VideoRoute } from "@/components/capture/engine/video-session";
import type { VideoUploadFailure } from "@/components/capture/hooks/useVideoUpload";
import styles from "@/components/ui/zen.module.css";

const INPUT =
  // 16px on phones stops iOS auto-zooming the viewport on focus; the sealed 13px
  // control returns at sm+. Same rule as the live review and the contribute form.
  "w-full rounded-[4px] border border-border bg-surface-elevated px-2.5 py-2 text-[16px] text-ink " +
  "placeholder:text-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]";

export function VideoReviewScreen({
  file,
  plan,
  framesKept,
  route,
  track,
  clockOffsetMs,
  clockNudgeMatters,
  storageFull,
  durable,
  uploading,
  uploadProgress,
  uploadFailure,
  onNudge,
  onUpload,
  onDiscard,
}: Readonly<{
  file: File;
  plan: ExtractionPlan;
  framesKept: number;
  route: VideoRoute;
  track: readonly TrackPoint[];
  clockOffsetMs: number;
  clockNudgeMatters: boolean;
  storageFull: boolean;
  durable: boolean;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  uploadFailure: VideoUploadFailure | null;
  onNudge: (offsetMs: number) => void;
  onUpload: (contact?: string) => void;
  onDiscard: () => void;
}>) {
  const t = useTranslations("collect");
  const [contact, setContact] = useState("");
  const [honeypot, setHoneypot] = useState("");

  // The same floor the server enforces, in the same words the live path uses:
  // finalize needs a two-fix track, and there is nothing to upload without
  // frames.
  const uploadable = framesKept > 0 && track.length >= 2;

  return (
    <Screen>
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("videoReview.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("videoReview.title")}
        </h1>
      </header>

      {storageFull ? <Notice tone="warn">{t("videoReview.storageFull")}</Notice> : null}
      {!durable ? <Notice tone="warn">{t("videoReview.notDurable")}</Notice> : null}

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
            {t("videoReview.mapLabel")}
          </figcaption>
        </figure>
      ) : null}

      <Plate className="grid grid-cols-2 gap-4 p-4">
        <Stat label={t("videoReview.frames")} value={framesKept} />
        <Stat label={t("videoReview.length")} value={formatDistance(pathLengthMeters(route.path))} />
        <Stat label={t("videoReview.duration")} value={formatElapsed(plan.durationMs)} />
        <Stat label={t("videoReview.points")} value={route.path.length} />
      </Plate>

      <Plate className="p-4">
        <Eyebrow>{t("videoReview.sourceEyebrow")}</Eyebrow>
        <p className="mt-1.5 text-[13px] text-ink">{t(`videoReview.source_${route.source}`)}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-strong">
          {clockNudgeMatters ? t("videoReview.timed") : t("videoReview.derived")}
        </p>
      </Plate>

      {clockNudgeMatters ? (
        <ClockNudge
          file={file}
          plan={plan}
          track={track}
          clockOffsetMs={clockOffsetMs}
          onNudge={onNudge}
        />
      ) : (
        // The honest line in place of a control that would provably do nothing.
        <Notice title={t("clock.hiddenTitle")}>{t("clock.hiddenBody")}</Notice>
      )}

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
              htmlFor="video-contact"
              className="mb-1 block text-[12px] font-medium text-ink"
            >
              {t("videoReview.contactLabel")}
            </label>
            <input
              id="video-contact"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              className={INPUT}
            />
            <p className="mt-1 text-[12px] text-neutral-strong">{t("videoReview.contactHint")}</p>
          </div>

          {/* Honeypot. Mirrors the live review and the manual contribute flow:
              off-screen rather than display:none, since some bots skip
              undisplayed fields. */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]">
            <label htmlFor="video-website">Website</label>
            <input
              id="video-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-neutral-strong">
            {t("videoReview.consent")}
          </p>

          {!uploadable ? <Notice tone="warn">{t("videoReview.tooShort")}</Notice> : null}

          <div className="flex flex-col gap-2">
            <Action variant="accent" type="submit" disabled={!uploadable} testId="video-upload">
              {uploadFailure ? t("uploadError.retry") : t("videoReview.upload")}
            </Action>
            <Action
              variant="ghost"
              onClick={() => {
                if (window.confirm(t("videoReview.discardConfirm"))) onDiscard();
              }}
            >
              {t("videoReview.discard")}
            </Action>
          </div>
        </form>
      )}
    </Screen>
  );
}
