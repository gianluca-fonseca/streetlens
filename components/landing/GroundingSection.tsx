"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 05 — References. The standards and datasets StreetLens leans on, cited
 * as plain text in a hairline definition list (the canonical References block),
 * never a logo wall. The open-source and open-data commitments close it as two
 * hairline entries, not shadowed cards.
 */
const GROUNDING_ITEMS = ["maps", "lanamme", "ley", "osm", "cosevi"] as const;

export default function GroundingSection() {
  const t = useTranslations("landing.grounding");

  return (
    <Section id="grounding" tone="paper" rule>
      <Measure width="outset">
        <SectionHeader
          index="06"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      {/* Five institutional citations as typographic text, not logos. */}
      <Measure width="text" className="mt-12">
        <dl className="border-t border-hairline">
          {GROUNDING_ITEMS.map((key) => (
            <div
              key={key}
              className="flex flex-col gap-1 border-b border-hairline py-5 sm:flex-row sm:items-baseline sm:gap-8"
            >
              <dt className="font-display text-[1.05rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display sm:w-44 sm:shrink-0">
                {t(`items.${key}.name`)}
              </dt>
              <dd className="font-serif text-[1rem] leading-[1.5] text-ink-muted">
                {t(`items.${key}.note`)}
              </dd>
            </div>
          ))}
        </dl>
      </Measure>

      {/* Open source and open data: the two standing commitments. */}
      <Measure width="text" className="mt-10">
        <div className="grid gap-px overflow-hidden rounded-[4px] border border-hairline bg-hairline sm:grid-cols-2">
          {(["openSource", "openData"] as const).map((key) => (
            <div key={key} className="bg-surface p-6">
              <p className="font-display text-[1.1rem] font-semibold leading-tight tracking-[-0.01em] text-ink-display">
                {t(`${key}.label`)}
              </p>
              <p className="mt-2 font-serif text-[1rem] leading-[1.5] text-ink-muted">
                {t(`${key}.note`)}
              </p>
            </div>
          ))}
        </div>
      </Measure>
    </Section>
  );
}
