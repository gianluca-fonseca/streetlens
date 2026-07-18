"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Eyebrow, Plate } from "@/components/capture/ui";
import { listMyWalks, type MyWalkEntry } from "@/lib/capture/my-walks";
import { formatDistance, formatElapsed } from "@/components/capture/engine/geo";

function subscribeMyWalks(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("streetlens-my-walks", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("streetlens-my-walks", onStoreChange);
  };
}

function getMyWalksSnapshot(): readonly MyWalkEntry[] {
  return listMyWalks();
}

function WalkRow({ entry }: Readonly<{ entry: MyWalkEntry }>) {
  const t = useTranslations("collect.myWalks");
  const streets =
    entry.streetNames && entry.streetNames.length > 0
      ? entry.streetNames.slice(0, 2).join(", ")
      : null;

  return (
    <li className="rounded-[4px] border border-border bg-surface-elevated px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/collect/status/${entry.sessionId}`}
          className="truncate text-[13px] font-medium text-ink underline-offset-2 hover:underline"
        >
          {streets ?? t("unnamedWalk")}
        </Link>
        {entry.status ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
            {t(`status.${entry.status}`)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-muted">
        {t("meta", {
          frames: entry.frameCount,
          distance: formatDistance(entry.distanceM),
          duration: formatElapsed(entry.elapsedMs),
        })}
      </p>
    </li>
  );
}

export function MyWalksShelf({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations("collect.myWalks");
  const entries = useSyncExternalStore(subscribeMyWalks, getMyWalksSnapshot, () => []);

  if (entries.length === 0) return null;

  return (
    <section className={className}>
      <Eyebrow>{t("eyebrow")}</Eyebrow>
      <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-strong">{t("lead")}</p>
      <Plate className="mt-3 p-3">
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <WalkRow key={entry.sessionId} entry={entry} />
          ))}
        </ul>
      </Plate>
    </section>
  );
}
