"use client";

import { useTranslations } from "next-intl";
import type { SegmentCollection, StreetStats } from "@/lib/segments";
import AuditMap from "@/components/AuditMap";
import Button from "@/components/ui/Button";
import Eyebrow from "@/components/ui/Eyebrow";
import Panel from "@/components/ui/Panel";

/**
 * The hero: a full-bleed calm read-only map of the Escazú corridor with a
 * soft-depth overlay panel (not glass, not a centered badge-pill). The panel
 * carries the eyebrow, headline, one support line, two CTAs, and the three
 * mono facts with the honest data note adjacent.
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

  return (
    <section className="relative h-full min-h-[600px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <AuditMap variant="hero" segments={segments} flyOnLoad />
      </div>

      <div className="relative z-10 mx-auto flex h-full max-w-6xl items-end px-4 pb-6 sm:px-6 md:items-center md:pb-0">
        <Panel
          as="section"
          radius="primary"
          elevation="popover"
          className="pointer-events-auto w-full max-w-md p-6 sm:p-7"
        >
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="mt-2.5 font-display text-[clamp(1.9rem,4.6vw,2.9rem)] font-semibold leading-[1.06] tracking-tight text-ink">
            {t("headline")}
          </h1>
          <p className="mt-3 text-[1.02rem] leading-relaxed text-neutral-strong">
            {t("support")}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button href="/map" variant="pine" size="lg">
              {t("ctaExplore")}
            </Button>
            <Button href="#method" variant="ghost" size="lg">
              {t("ctaMethod")}
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5">
            {facts.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <dt className="sr-only">{f.label}</dt>
                <dd className="font-mono text-[1.35rem] font-medium leading-none text-ink">
                  {f.value}
                </dd>
                <span
                  aria-hidden="true"
                  className="text-[11px] leading-tight text-neutral-strong"
                >
                  {f.label}
                </span>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11.5px] leading-snug text-neutral-strong">
            {t("statsNote")}
          </p>
        </Panel>
      </div>
    </section>
  );
}
