"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";

/**
 * "Where this goes": an honest scale path from one corridor to an open standard.
 * A vertical ordered list on a hairline rail, each row carrying a mono step
 * index, a real status chip (Now vs Planned), the stage title, and what it
 * means. This reads as a roadmap, not a numbered marketing sequence.
 */
const ROADMAP_STEPS = ["pilot", "canton", "compare", "api"] as const;

export default function RoadmapSection() {
  const t = useTranslations("landing.roadmap");

  return (
    <Section id="roadmap" tone="bone">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.7rem,3.8vw,2.6rem)] font-semibold leading-[1.12] tracking-tight text-ink">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
          {t("lead")}
        </p>
      </Reveal>

      <ol className="mt-12 border-l border-border">
        {ROADMAP_STEPS.map((key, i) => {
          const isNow = i === 0;
          return (
            <Reveal
              key={key}
              as="li"
              delay={i * 80}
              className="relative pb-9 pl-8 last:pb-0"
            >
              {/* Rail node aligned to the ordered-list left border. */}
              <span
                aria-hidden="true"
                className={
                  "absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border " +
                  (isNow
                    ? "border-terracotta bg-terracotta"
                    : "border-border-strong bg-surface")
                }
              />
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[12px] font-medium text-neutral-strong">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    "rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] " +
                    (isNow
                      ? "border-terracotta text-terracotta"
                      : "border-border text-pine")
                  }
                >
                  {t(`steps.${key}.status`)}
                </span>
              </div>
              <h3 className="mt-2 font-display text-[1.25rem] font-semibold leading-tight text-ink">
                {t(`steps.${key}.title`)}
              </h3>
              <p className="mt-1.5 max-w-xl text-[0.98rem] leading-relaxed text-neutral-strong">
                {t(`steps.${key}.desc`)}
              </p>
            </Reveal>
          );
        })}
      </ol>
    </Section>
  );
}
