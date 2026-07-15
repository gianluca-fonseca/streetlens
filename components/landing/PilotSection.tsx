"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import type { StreetStats } from "@/lib/segments";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import StatFigure from "@/components/ui/StatFigure";
import GlassPanel from "@/components/ui/GlassPanel";

/**
 * "Where we're starting": the Escazú pilot profiled honestly. The rendered
 * San Antonio corridor sits under a glass label; the real pilot figures
 * (segments / km / coverage) and the demo caveat sit alongside. Only the pilot
 * is claimed as existing; the rest of the canton is framed as what follows.
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
    <Section id="pilot" tone="sunken">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-14">
        <Reveal>
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h2 className="mt-3 font-display text-[clamp(1.85rem,3.9vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink">
            {t("heading")}
          </h2>
          <p className="mt-4 max-w-xl text-[1.05rem] leading-relaxed text-neutral-strong">
            {t("lead")}
          </p>

          <div className="mt-8 grid grid-cols-3 gap-6 border-t border-border pt-6">
            {figures.map((f) => (
              <StatFigure
                key={f.key}
                value={f.value}
                unit={f.unit}
                label={f.label}
                size="md"
              />
            ))}
          </div>
          <p className="mt-5 max-w-xl text-[12.5px] leading-snug text-neutral-strong">
            {t("demoNote")}
          </p>
        </Reveal>

        <Reveal delay={120}>
          <figure className="relative overflow-hidden rounded-[12px] border border-border shadow-[var(--shadow-panel)]">
            <img
              src="/render/district-san-antonio.svg"
              alt="Rendered map of the San Antonio de Escazú pilot corridor"
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <GlassPanel
              as="figcaption"
              radius="panel"
              elevation="popover"
              className="absolute left-3 top-3 max-w-[15rem] p-4"
            >
              <Eyebrow>{t("corridorEyebrow")}</Eyebrow>
              <p className="mt-1.5 font-display text-[1.15rem] font-semibold leading-tight text-ink">
                {t("corridorName")}
              </p>
              <p className="mt-2 text-[12.5px] leading-snug text-neutral-strong">
                {t("corridorNote")}
              </p>
            </GlassPanel>
          </figure>
        </Reveal>
      </div>
    </Section>
  );
}
