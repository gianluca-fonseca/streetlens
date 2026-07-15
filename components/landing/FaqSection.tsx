"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";

/**
 * "Questions": six honest answers as native <details> rows, so the accordion is
 * accessible and needs no JavaScript. Hairline dividers separate the rows and an
 * inline chevron rotates on open via the group-open state. Order is fixed.
 */
const FAQ_ITEMS = [
  "real",
  "scores",
  "city",
  "fieldwork",
  "contribute",
  "who",
] as const;

export default function FaqSection() {
  const t = useTranslations("landing.faq");

  return (
    <Section id="faq" tone="sunken">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.85rem,3.9vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink">
          {t("heading")}
        </h2>
      </Reveal>

      <Reveal delay={60} className="mt-10 border-t border-border">
        {FAQ_ITEMS.map((key) => (
          <details key={key} className="group border-b border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
              <span className="text-[1.05rem] font-medium leading-snug text-ink">
                {t(`items.${key}.q`)}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-neutral-strong transition-transform duration-300 ease-out group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="max-w-2xl pb-5 text-[0.98rem] leading-relaxed text-neutral-strong">
              {t(`items.${key}.a`)}
            </p>
          </details>
        ))}
      </Reveal>
    </Section>
  );
}
