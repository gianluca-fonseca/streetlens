"use client";

/**
 * The end of a walk — receipt card + status link.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Action, Eyebrow, Screen } from "@/components/capture/ui";
import { WalkReceipt } from "@/components/capture/WalkReceipt";
import type { TrackPoint } from "@/lib/capture/types";

export function DoneScreen({
  sessionId,
  frameCount,
  distanceM,
  elapsedMs,
  track,
  streetNames,
  submittedAt,
  onAgain,
}: Readonly<{
  sessionId: string | null;
  frameCount: number;
  distanceM: number;
  elapsedMs: number;
  track: readonly TrackPoint[];
  streetNames?: readonly string[];
  submittedAt: Date;
  onAgain: () => void;
}>) {
  const t = useTranslations("collect");

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("done.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("done.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">{t("done.body")}</p>
      </header>

      {sessionId ? (
        <WalkReceipt
          sessionId={sessionId}
          frameCount={frameCount}
          distanceM={distanceM}
          elapsedMs={elapsedMs}
          track={track}
          streetNames={streetNames}
          submittedAt={submittedAt}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {sessionId ? (
          <Link
            href={`/collect/status/${sessionId}`}
            className="inline-flex w-full items-center justify-center rounded-[6px] border border-ink-display bg-ink-display px-4 py-3 text-[15px] font-medium text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("done.statusLink")}
          </Link>
        ) : null}
        <Action variant="ghost" onClick={onAgain}>
          {t("done.again")}
        </Action>
      </div>
    </Screen>
  );
}
