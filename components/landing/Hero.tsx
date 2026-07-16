"use client";

import { useTranslations } from "next-intl";
import type { SegmentCollection, StreetStats } from "@/lib/segments";
import AuditMap from "@/components/AuditMap";
import Button from "@/components/ui/Button";
import Eyebrow from "@/components/ui/Eyebrow";
import Measure from "@/components/ui/Measure";
import Figure from "@/components/ui/Figure";

/**
 * The masthead: a centered academic-paper opening. A mono eyebrow, the bold-black
 * thesis H1, a centered italic abstract, one pink primary call and a pink-underline
 * secondary link. Below it, the live Escazú map is presented as FIGURE 1: a matted
 * plate (composed here, outside AuditMap) with a full journal caption. The map
 * itself stays the untouched `variant="hero"` canvas with its reduced-motion-safe
 * corridor glide; the frame is ours.
 */
export default function Hero({
  segments,
  stats,
}: Readonly<{
  segments: SegmentCollection;
  stats: StreetStats;
}>) {
  const t = useTranslations("landing.hero");

  return (
    <section className="pb-[3.5rem] pt-[max(4rem,calc(env(safe-area-inset-top)+2.5rem))] sm:pb-16 sm:pt-28">
      <Measure width="outset" className="text-center">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="mx-auto mt-5 max-w-[18ch] font-display text-[clamp(2.5rem,6vw,5rem)] font-bold leading-[1.03] tracking-[-0.03em] text-ink-display text-balance">
          {t("thesis")}
        </h1>
        <p className="mx-auto mt-7 max-w-[40rem] font-serif text-[clamp(1.15rem,2.2vw,1.4rem)] italic leading-[1.5] text-ink text-pretty">
          {t("abstract")}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            href="/map"
            variant="accent"
            size="lg"
            className="min-h-[48px] w-full sm:w-auto"
          >
            {t("ctaExplore")}
          </Button>
          <a
            href="#method"
            className="inline-flex min-h-[48px] items-center font-medium text-ink underline decoration-accent decoration-2 underline-offset-[6px] transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {t("ctaMethod")}
          </a>
        </div>
      </Measure>

      <Measure width="screen" className="mt-14 sm:mt-20">
        <div className="mx-auto max-w-[1240px] px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-6 lg:px-8">
          <Figure
            id="figure-1"
            label={t("figure.label")}
            claim={t("figure.claim")}
            support={t("figure.support")}
            source={t("figure.source", { n: stats.segments })}
            affordance={t("figure.affordance")}
            live={{ label: t("figure.live") }}
            aspectClassName="aspect-[3/4] sm:aspect-[3/2] lg:aspect-[16/10]"
          >
            <AuditMap variant="hero" segments={segments} flyOnLoad />
          </Figure>
        </div>
      </Measure>
    </section>
  );
}
