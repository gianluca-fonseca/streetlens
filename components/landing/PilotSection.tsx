"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import type { StreetStats } from "@/lib/segments";
import { showDemoData } from "@/lib/demo-flag";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";
import Figure from "@/components/ui/Figure";
import StatFigure from "@/components/ui/StatFigure";

/**
 * Section 03 — the pilot. Restacked to a single centered axis: the thesis, the
 * San Antonio corridor as Figure 3 (a matted rendered plate, captioned), then
 * the real pilot figures as a mono hairline row. Only the pilot is claimed as
 * existing; the rest of the canton is what follows, on the same rubric.
 */
export default function PilotSection({
  stats,
}: Readonly<{
  stats: StreetStats;
}>) {
  const t = useTranslations("landing.pilot");

  const figures = [
    { key: "segments", value: String(stats.segments), label: t("statSegments") },
    { key: "km", value: stats.km.toFixed(1), unit: "km", label: t("statKm") },
    { key: "coverage", value: String(stats.coveragePct), unit: "%", label: t("statCoverage") },
  ];

  return (
    <Section id="pilot" tone="paper" rule>
      <Measure width="outset">
        <SectionHeader
          index="04"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="page" className="mt-14 sm:mt-16">
        <Figure
          id="figure-3"
          label={t("figure.label")}
          claim={t("figure.claim")}
          support={t("figure.support")}
          source={t("figure.source")}
          aspectClassName="aspect-[4/3] lg:aspect-[16/9]"
        >
          <img
            src="/render/district-san-antonio.svg"
            alt={t("figure.alt")}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </Figure>
      </Measure>

      <Measure width="text" className="mt-12">
        <dl className="grid grid-cols-3 gap-6 border-t border-hairline pt-6">
          {figures.map((f) => (
            <StatFigure
              key={f.key}
              value={f.value}
              unit={f.unit}
              label={f.label}
              size="md"
            />
          ))}
        </dl>
        <p className="mt-8 font-serif text-[1.08rem] leading-[1.55] text-accent-text">
          {t("beginning")}
        </p>
        {showDemoData() && (
          <p className="mt-5 text-[12.5px] leading-snug text-ink-muted">
            {t("demoNote")}
          </p>
        )}
      </Measure>
    </Section>
  );
}
