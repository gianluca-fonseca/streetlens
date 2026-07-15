"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import StatFigure from "@/components/ui/StatFigure";
import GlassPanel from "@/components/ui/GlassPanel";

/**
 * The dark warm "field" section: the accountability gap, framed universally
 * (most cities cannot say which sidewalks fail, or where) with the honest Costa
 * Rican anchors as proof. The dark atlas render sits behind as earned imagery,
 * so the three stat callouts can float in glass. Only the demo figure is
 * caveated.
 */
export default function GapSection({
  heroPct,
}: Readonly<{
  heroPct: number;
}>) {
  const t = useTranslations("landing.gap");

  const callouts = [
    { key: "1", value: t("stat1Value"), label: t("stat1Label"), note: t("stat1Note") },
    { key: "2", value: t("stat2Value"), label: t("stat2Label"), note: t("stat2Note") },
    { key: "3", value: `${heroPct}%`, label: t("stat3Label"), note: t("stat3Note") },
  ];

  return (
    <Section
      id="gap"
      tone="field"
      contained={false}
      className="relative overflow-hidden"
    >
      <img
        src="/render/atlas-dark.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#14140f]/70 via-[#14140f]/40 to-[#14140f]/80"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <Reveal className="max-w-3xl">
          <Eyebrow tone="muted">{t("eyebrow")}</Eyebrow>
          <h2 className="mt-3 font-display text-[clamp(1.7rem,3.8vw,2.6rem)] font-semibold leading-[1.12] tracking-tight text-ink">
            {t("heading")}
          </h2>
          <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
            {t("lead")}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {callouts.map((c, i) => (
            <Reveal key={c.key} as="div" delay={i * 90}>
              <GlassPanel radius="panel" elevation="popover" className="h-full p-6">
                <StatFigure
                  value={c.value}
                  label={c.label}
                  sublabel={c.note}
                  tone="terracotta"
                  size="lg"
                />
              </GlassPanel>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
