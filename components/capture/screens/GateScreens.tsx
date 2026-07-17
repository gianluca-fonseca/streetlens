"use client";

/**
 * The two screens that stand before a walk: "this device cannot", and "you left
 * one unfinished".
 *
 * Recovery is offered rather than performed. An unfinished walk on disk is the
 * walker's, and silently resuming or silently binning it are both decisions that
 * are not ours to make.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Action, Eyebrow, Plate, Screen, Stat } from "@/components/capture/ui";
import { formatDistance, trackDistanceMeters } from "@/components/capture/engine/geo";
import type { SessionManifest } from "@/components/capture/engine/session";
import type { UnsupportedReason } from "@/components/capture/hooks/useRecorder";

export function UnsupportedScreen({ reason }: Readonly<{ reason: UnsupportedReason }>) {
  const t = useTranslations("collect");
  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("unsupported.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("unsupported.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t(`unsupported.${reason}`)}
        </p>
      </header>
      <Link
        href="/map"
        className="inline-flex w-full items-center justify-center rounded-[6px] border border-border-strong px-4 py-3 text-[15px] font-medium text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        {t("unsupported.backToMap")}
      </Link>
    </Screen>
  );
}

export function RecoverScreen({
  manifest,
  onRecover,
  onDiscard,
}: Readonly<{
  manifest: SessionManifest;
  onRecover: () => void;
  onDiscard: () => void;
}>) {
  const t = useTranslations("collect");
  const distance = formatDistance(trackDistanceMeters(manifest.track));

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("recover.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("recover.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("recover.body", { frames: manifest.frames.length, distance })}
        </p>
      </header>

      <Plate className="grid grid-cols-2 gap-4 p-4">
        <Stat label={t("review.frames")} value={manifest.frames.length} />
        <Stat label={t("review.distance")} value={distance} />
      </Plate>

      <div className="flex flex-col gap-2">
        <Action variant="accent" onClick={onRecover}>
          {t("recover.upload")}
        </Action>
        <Action variant="ghost" onClick={onDiscard}>
          {t("recover.discard")}
        </Action>
      </div>
    </Screen>
  );
}
