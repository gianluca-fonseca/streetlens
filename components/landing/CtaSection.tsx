"use client";

/* eslint-disable @next/next/no-img-element -- first-party static SVG map art; next/image adds no value for inline SVG and would need dangerouslyAllowSVG */
import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";

/**
 * The closing invitation: a full-bleed band over the static rendered atlas.
 * Earned glass sits on top of the imagery (the one flat-surface exception on
 * this page), carrying the eyebrow, heading, support line, and the two routes
 * into the app. A soft scrim keeps the text AA over the render.
 */
export default function CtaSection() {
  const t = useTranslations("landing.cta");

  return (
    <Section id="cta" tone="bone" contained={false} className="relative overflow-hidden">
      <img
        src="/render/atlas-wide.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#14140f]/70 via-[#14140f]/45 to-[#14140f]/70"
      />

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <Reveal className="max-w-xl">
          <GlassPanel as="section" radius="primary" elevation="popover" className="p-8 sm:p-10">
            <Eyebrow tone="muted">{t("eyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display text-[clamp(1.85rem,3.9vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink">
              {t("heading")}
            </h2>
            <p className="mt-4 text-[1.05rem] leading-relaxed text-neutral-strong">
              {t("support")}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button
                href="/map"
                variant="pine"
                size="lg"
                className="min-h-[48px] w-full sm:w-auto"
              >
                {t("explore")}
              </Button>
              <Button
                href="/map"
                variant="ghost"
                size="lg"
                className="min-h-[48px] w-full sm:w-auto"
              >
                {t("contribute")}
              </Button>
            </div>
          </GlassPanel>
        </Reveal>
      </div>
    </Section>
  );
}
