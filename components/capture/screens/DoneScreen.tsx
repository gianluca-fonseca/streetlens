"use client";

/**
 * The end of a walk.
 *
 * The status link is honest about what it leads to: matching and review run in a
 * part of the pipeline that is not live yet, so the status page says "processing
 * starts shortly" rather than inventing a progress bar for work nothing is doing.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Action, Eyebrow, Screen } from "@/components/capture/ui";

export function DoneScreen({
  sessionId,
  onAgain,
}: Readonly<{ sessionId: string | null; onAgain: () => void }>) {
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
