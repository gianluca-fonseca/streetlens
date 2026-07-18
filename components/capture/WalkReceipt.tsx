"use client";

import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";
import { Action, Eyebrow, Plate, Stat } from "@/components/capture/ui";
import { formatDistance, formatElapsed } from "@/components/capture/engine/geo";
import { TrackMiniMap } from "@/components/capture/TrackMiniMap";
import type { TrackPoint } from "@/lib/capture/types";

export function WalkReceipt({
  sessionId,
  frameCount,
  distanceM,
  elapsedMs,
  track,
  streetNames,
  submittedAt,
}: Readonly<{
  sessionId: string;
  frameCount: number;
  distanceM: number;
  elapsedMs: number;
  track: readonly TrackPoint[];
  streetNames?: readonly string[];
  submittedAt: Date;
}>) {
  const t = useTranslations("collect.receipt");
  const dateLabel = submittedAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const streets =
    streetNames && streetNames.length > 0 ? streetNames.join(", ") : t("streetsPending");

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname.replace(/\/collect.*/, "")}/collect/status/${sessionId}`;
    const text = t("shareText", {
      streets,
      frames: frameCount,
      date: dateLabel,
    });
    if (navigator.share) {
      try {
        await navigator.share({ title: t("shareTitle"), text, url });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
    } catch {
      // non-fatal
    }
  };

  return (
    <Plate className="flex flex-col gap-4 overflow-hidden p-0">
      {track.length >= 2 ? (
        <figure className="relative h-[140px] w-full overflow-hidden border-b border-border">
          <TrackMiniMap track={track} />
        </figure>
      ) : null}
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div>
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <p className="mt-2 font-serif text-[17px] leading-[1.5] text-ink">{streets}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{dateLabel}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("frames")} value={frameCount} />
          <Stat label={t("distance")} value={formatDistance(distanceM)} />
          <Stat label={t("duration")} value={formatElapsed(elapsedMs)} />
        </div>
        <p className="text-[12px] leading-relaxed text-neutral-strong">{t("pendingNote")}</p>
        <Action variant="ghost" onClick={() => void share()}>
          <Share2 size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("share")}
        </Action>
      </div>
    </Plate>
  );
}
