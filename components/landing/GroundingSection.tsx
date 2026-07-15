"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Eyebrow from "@/components/ui/Eyebrow";
import Reveal from "@/components/ui/Reveal";
import Panel from "@/components/ui/Panel";

/**
 * "Built to be checked": the standards and datasets StreetLens leans on, cited
 * as plain text (name + note), never as a logo wall or icon cards. A
 * hairline-divided definition list carries the five citations; the open-source
 * and open-data commitments close it as two emphasized panels.
 */
const GROUNDING_ITEMS = ["maps", "lanamme", "ley", "osm", "cosevi"] as const;

export default function GroundingSection() {
  const t = useTranslations("landing.grounding");

  return (
    <Section id="grounding" tone="sunken">
      <Reveal className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="mt-3 font-display text-[clamp(1.85rem,3.9vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-neutral-strong">
          {t("lead")}
        </p>
      </Reveal>

      {/* Five institutional citations as typographic text, not logos. */}
      <Reveal delay={60} className="mt-12">
        <dl className="grid border-t border-border sm:grid-cols-2 sm:gap-x-12">
          {GROUNDING_ITEMS.map((key) => (
            <div
              key={key}
              className="flex flex-col gap-1 border-b border-border py-5 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <dt className="font-display text-[1.05rem] font-semibold leading-tight text-ink sm:w-40 sm:shrink-0">
                {t(`items.${key}.name`)}
              </dt>
              <dd className="text-[0.95rem] leading-relaxed text-neutral-strong">
                {t(`items.${key}.note`)}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {/* Open source and open data: the two standing commitments. */}
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {(["openSource", "openData"] as const).map((key, i) => (
          <Reveal key={key} as="div" delay={i * 90}>
            <Panel elevation="panel" className="h-full p-6 sm:p-7">
              <p className="font-display text-[1.1rem] font-semibold leading-tight text-ink">
                {t(`${key}.label`)}
              </p>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-neutral-strong">
                {t(`${key}.note`)}
              </p>
            </Panel>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
