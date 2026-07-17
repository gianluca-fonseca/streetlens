"use client";

/**
 * The end of an upload.
 *
 * `screens/DoneScreen.tsx`'s twin, and honest in the same way: the status link
 * leads to a page that says processing starts shortly, because matching and
 * review run in a part of the pipeline that is not live yet. Inventing a progress
 * bar for work nothing is doing would be the easiest lie on this whole flow to
 * tell and the least defensible.
 *
 * "Upload another video" routes back through `discard`, exactly as the live path
 * does. That is not a reset of a form: the frames of the finished session are
 * deleted off the device on the way out. They are on the server now, and keeping
 * a second copy in OPFS would sit there eating a phone's quota until the next
 * session needed the room and could not have it.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Action, Eyebrow, Screen } from "@/components/capture/ui";

export function VideoDoneScreen({
  sessionId,
  onAgain,
}: Readonly<{ sessionId: string | null; onAgain: () => void }>) {
  const t = useTranslations("collect");

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("videoDone.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("videoDone.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("videoDone.body")}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {sessionId ? (
          <Link
            href={`/collect/status/${sessionId}`}
            className="inline-flex w-full items-center justify-center rounded-[6px] border border-ink-display bg-ink-display px-4 py-3 text-[15px] font-medium text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("videoDone.statusLink")}
          </Link>
        ) : null}
        <Action variant="ghost" onClick={onAgain}>
          {t("videoDone.again")}
        </Action>
      </div>
    </Screen>
  );
}
