"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import Eyebrow from "@/components/ui/Eyebrow";
import Button from "@/components/ui/Button";

/**
 * The closing band — the manifesto as a letterpress negative. A single
 * inverted-paper stretch (warm near-black ground, creme ink) carrying the final
 * thesis, a serif close, the pink primary call, and a hairline secondary. Flat:
 * hairlines and the tone flip carry it, no imagery, no glass (the old dark atlas
 * band with glass over it is retired).
 */
export default function CtaSection() {
  const t = useTranslations("landing.cta");

  return (
    <Section id="cta" tone="inverted" spacing="lg">
      <Measure width="outset" className="text-center">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mx-auto mt-5 max-w-[16ch] font-display text-[clamp(2.25rem,5vw,3.5rem)] font-bold leading-[1.04] tracking-[-0.025em] text-ink-display text-balance">
          {t("heading")}
        </h2>
        <p className="mx-auto mt-6 max-w-[38rem] font-serif text-[1.18rem] leading-[1.55] text-ink text-pretty">
          {t("support")}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            href="/map"
            variant="accent"
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
      </Measure>
    </Section>
  );
}
