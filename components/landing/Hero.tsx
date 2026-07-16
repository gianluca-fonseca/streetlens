"use client";

import { useTranslations } from "next-intl";
import type { SegmentCollection, StreetStats } from "@/lib/segments";
import AuditMap from "@/components/AuditMap";
import Button from "@/components/ui/Button";
import Eyebrow from "@/components/ui/Eyebrow";
import GlassPanel from "@/components/ui/GlassPanel";

/**
 * The hero: a full-bleed live map of the Escazú corridor (the one live MapLibre
 * instance on the page) with earned glass layered over it, Genesis-style. A
 * primary glass panel carries the platform headline and CTAs; two floating
 * glass data cards read as a dashboard over the map: the live-pilot snapshot and
 * the demo Ley-7600 fail-rate with its caveat. On small screens the two cards
 * collapse into the main panel so nothing clips.
 */
export default function Hero({
  segments,
  stats,
}: Readonly<{
  segments: SegmentCollection;
  stats: StreetStats;
}>) {
  const t = useTranslations("landing.hero");

  const facts = [
    { key: "segments", value: String(stats.segments), label: t("statSegments") },
    { key: "km", value: stats.km.toFixed(1), label: t("statKm") },
    { key: "coverage", value: `${stats.coveragePct}%`, label: t("statCoverage") },
  ];

  const snapshot = (
    <>
      <Eyebrow>{t("snapshotLabel")}</Eyebrow>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {facts.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <dt className="sr-only">{f.label}</dt>
            <dd className="font-mono text-[1.3rem] font-medium leading-none text-ink">
              {f.value}
            </dd>
            <span
              aria-hidden="true"
              className="text-[10.5px] leading-tight text-neutral-strong"
            >
              {f.label}
            </span>
          </div>
        ))}
      </dl>
    </>
  );

  const demoStat = (
    <>
      <p className="font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-accent-text">
        {stats.heroPct}%
      </p>
      <p className="mt-2 text-[0.9rem] leading-snug text-ink">
        {t("heroStatShort")}
      </p>
      <p className="mt-2 text-[11px] leading-snug text-neutral-strong">
        {t("heroStatDemo")}
      </p>
    </>
  );

  return (
    <section className="relative h-full min-h-[640px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <AuditMap variant="hero" segments={segments} flyOnLoad />
      </div>

      <div className="relative z-10 mx-auto h-full max-w-6xl px-4 sm:px-6">
        {/* Main glass panel: brand + headline + CTAs */}
        <div className="flex h-full flex-col justify-end pb-[max(1.5rem,env(safe-area-inset-bottom))] md:justify-center md:pb-0">
          <GlassPanel
            as="section"
            radius="primary"
            elevation="popover"
            className="w-full max-w-md p-6 sm:p-7"
          >
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="mt-2.5 font-display text-[clamp(2.05rem,4.7vw,3.15rem)] font-bold leading-[1.02] tracking-[-0.03em] text-ink">
              {t("headline")}
            </h1>
            <p className="mt-3 text-[1.02rem] leading-relaxed text-neutral-strong">
              {t("support")}
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button
                href="/map"
                variant="pine"
                size="lg"
                className="min-h-[48px] w-full sm:w-auto"
              >
                {t("ctaExplore")}
              </Button>
              <Button
                href="#method"
                variant="ghost"
                size="lg"
                className="min-h-[48px] w-full sm:w-auto"
              >
                {t("ctaMethod")}
              </Button>
            </div>

            {/* Small screens: fold the two data cards into the panel */}
            <div className="mt-6 border-t border-border pt-5 md:hidden">
              {snapshot}
              <div className="mt-4 border-t border-border pt-4">{demoStat}</div>
            </div>
          </GlassPanel>
        </div>

        {/* Desktop: two floating glass data cards over the map */}
        <GlassPanel
          radius="panel"
          elevation="popover"
          className="pointer-events-none absolute right-4 top-16 hidden w-60 p-5 md:block lg:right-6"
        >
          {snapshot}
        </GlassPanel>
        <GlassPanel
          radius="panel"
          elevation="popover"
          className="pointer-events-none absolute bottom-14 right-10 hidden w-60 p-5 md:block lg:right-16"
        >
          {demoStat}
        </GlassPanel>
      </div>
    </section>
  );
}
