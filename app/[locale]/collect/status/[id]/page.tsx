/**
 * Walk status.
 *
 * This page used to be an honest placeholder: matching, extraction and rollups
 * were not live, so it said so rather than animating a progress bar for work
 * nothing was doing. They are live now, and the same honesty rule points the
 * other way: the page reports what the pipeline actually did, including the
 * parts that are slow, paused or failed.
 *
 * The frame is server-rendered and the moving parts are not. Everything below is
 * one uuid-scoped fetch loop, so it belongs in the client; the header, the id and
 * the way out do not change and should not wait on a poll.
 *
 * No `generateStaticParams`: the id is only knowable at request time, so the
 * route renders dynamically, which is the correct default here.
 */

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StatusClient } from "@/components/capture/StatusClient";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "collect.status.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function CollectStatusPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale; id: string }> }>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "collect.status" });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-5 py-12 pb-safe">
        <header className="flex flex-col gap-3">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
            {t("title")}
          </h1>
          <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">{t("body")}</p>
        </header>

        {/* The id is not validated here. The route it polls rejects a non-uuid
            with 400 and an unknown one with 404, and the client says so; a second
            copy of that rule in this file would be a second thing to get wrong. */}
        <StatusClient sessionId={id} />

        <div className="rounded-[4px] border border-border bg-surface-elevated p-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
            {t("sessionLabel")}
          </p>
          {/* Wraps because a uuid does not fit a phone at this size, and it is the
              one thing on this page worth copying. */}
          <p className="mt-1 break-all font-mono text-[13px] text-ink">{id}</p>
        </div>

        <Link
          href="/map"
          className="inline-flex w-full items-center justify-center rounded-[6px] border border-border-strong px-4 py-3 text-[15px] font-medium text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          {t("backToMap")}
        </Link>
      </div>
    </main>
  );
}
