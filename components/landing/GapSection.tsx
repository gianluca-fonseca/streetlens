"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import StatFigure from "@/components/ui/StatFigure";

/**
 * The dark warm "field" section: the accountability gap. The Ley 7600 angle
 * leads; three honest stat callouts in big mono numerals with terracotta
 * accents. The one demo figure carries its caveat.
 */
export default function GapSection({
  heroPct,
}: Readonly<{
  heroPct: number;
}>) {
  const t = useTranslations("landing.gap");

  const callouts = [
    {
      key: "1",
      value: t("stat1Value"),
      label: t("stat1Label"),
      note: t("stat1Note"),
    },
    {
      key: "2",
      value: t("stat2Value"),
      label: t("stat2Label"),
      note: t("stat2Note"),
    },
    {
      key: "3",
      value: `${heroPct}%`,
      label: t("stat3Label"),
      note: t("stat3Note"),
    },
  ];

  return (
    <Section id="gap" tone="field">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.7rem,3.8vw,2.6rem)] font-semibold leading-[1.12] tracking-tight text-ink">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
          {t("lead")}
        </p>
      </Reveal>

      <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {callouts.map((c, i) => (
          <Reveal key={c.key} as="div" delay={i * 90}>
            <div className="border-t border-border pt-6">
              <StatFigure
                value={c.value}
                label={c.label}
                sublabel={c.note}
                tone="terracotta"
                size="lg"
              />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
