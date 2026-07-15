"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import GlassPanel from "@/components/ui/GlassPanel";

/**
 * "What we measure": the four lenses as a general instrument. Each lens pairs
 * its real rendered map extract (built from the demo geometry in that lens's
 * real ramp) with a glass legend card carrying the descriptor and the actual
 * low-to-high ramp. Earned glass, always over map imagery.
 */
type Lens = {
  key: "accessibility" | "drainage" | "shade" | "bike";
  img: string;
  /** The real mapConfig ramp stops at score 0 / 50 / 100 (low to high). */
  stops: [string, string, string];
};

const LENSES: readonly Lens[] = [
  { key: "accessibility", img: "/render/lens-accessibility.svg", stops: ["#FFE945", "#7C7B78", "#00204D"] },
  { key: "drainage", img: "/render/lens-drainage.svg", stops: ["#C7C13B", "#4CA377", "#21808C"] },
  { key: "shade", img: "/render/lens-shade.svg", stops: ["#DDE3CE", "#6E9463", "#14532D"] },
  { key: "bike", img: "/render/lens-bike.svg", stops: ["#E8D9C4", "#C88C5E", "#8A4B2D"] },
];

export default function MeasureSection() {
  const t = useTranslations("landing.measure");

  return (
    <Section id="measure" tone="bone">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.7rem,3.8vw,2.6rem)] font-semibold leading-[1.12] tracking-tight text-ink">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
          {t("lead")}
        </p>
      </Reveal>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {LENSES.map((lens, i) => (
          <Reveal key={lens.key} as="div" delay={i * 80}>
            <figure className="relative overflow-hidden rounded-[12px] border border-border shadow-[var(--shadow-panel)]">
              <img
                src={lens.img}
                alt={`${t(`items.${lens.key}.name`)} score map of the pilot street network`}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <GlassPanel
                as="figcaption"
                radius="panel"
                elevation="panel"
                className="absolute inset-x-3 bottom-3 p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[1.1rem] font-semibold leading-none text-ink">
                    {t(`items.${lens.key}.name`)}
                  </p>
                </div>
                <p className="mt-2 text-[13px] leading-snug text-neutral-strong">
                  {t(`items.${lens.key}.desc`)}
                </p>
                <div
                  className="mt-3 h-1.5 w-full rounded-full"
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${lens.stops[0]}, ${lens.stops[1]}, ${lens.stops[2]})`,
                  }}
                  aria-hidden="true"
                />
                <div className="mt-1.5 flex justify-between text-[11px] font-medium text-neutral-strong">
                  <span>{t(`items.${lens.key}.low`)}</span>
                  <span>{t(`items.${lens.key}.high`)}</span>
                </div>
              </GlassPanel>
            </figure>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
