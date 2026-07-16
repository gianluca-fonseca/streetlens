"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 06 — the scale path. Stacked numbered entries on a hairline stack (no
 * left rail, which is intrinsically left-anchored): each row carries a mono step
 * index, a real status chip (Now in pink, Planned muted), the stage title, and
 * what it means. A roadmap, not a marketing 1-2-3.
 */
const ROADMAP_STEPS = ["pilot", "canton", "compare", "api"] as const;

export default function RoadmapSection() {
  const t = useTranslations("landing.roadmap");

  return (
    <Section id="roadmap" tone="sunken" rule>
      <Measure width="outset">
        <SectionHeader
          index="06"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="text" className="mt-12">
        <ol className="border-t border-hairline">
          {ROADMAP_STEPS.map((key, i) => {
            const isNow = i === 0;
            return (
              <li key={key} className="border-b border-hairline py-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[12px] font-medium tabular-nums text-ink-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={
                      "rounded-[2px] border px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] " +
                      (isNow
                        ? "border-accent-text text-accent-text"
                        : "border-hairline-strong text-ink-muted")
                    }
                  >
                    {t(`steps.${key}.status`)}
                  </span>
                </div>
                <h3 className="mt-2.5 font-display text-[1.25rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display">
                  {t(`steps.${key}.title`)}
                </h3>
                <p className="mt-1.5 font-serif text-[1.02rem] leading-[1.55] text-ink-muted">
                  {t(`steps.${key}.desc`)}
                </p>
              </li>
            );
          })}
        </ol>
      </Measure>
    </Section>
  );
}
