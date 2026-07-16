"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 07 — questions. Six honest answers as native <details> rows inside the
 * text column: accessible, no JavaScript, hairline dividers, serif answers. An
 * inline chevron rotates on open via the group-open state.
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
    <Section id="faq" tone="paper" rule>
      <Measure width="outset">
        <SectionHeader index="07" eyebrow={t("eyebrow")} title={t("heading")} />
      </Measure>

      <Measure width="text" className="mt-12">
        <div className="border-t border-hairline">
          {FAQ_ITEMS.map((key) => (
            <details key={key} className="group border-b border-hairline">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
                <span className="font-display text-[1.05rem] font-medium leading-snug tracking-[-0.01em] text-ink-display">
                  {t(`items.${key}.q`)}
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 shrink-0 text-ink-muted transition-transform duration-300 ease-out group-open:rotate-180 motion-reduce:transition-none"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </summary>
              <p className="pb-5 font-serif text-[1.05rem] leading-[1.6] text-ink-muted">
                {t(`items.${key}.a`)}
              </p>
            </details>
          ))}
        </div>
      </Measure>
    </Section>
  );
}
