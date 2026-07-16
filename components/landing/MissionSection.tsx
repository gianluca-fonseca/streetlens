"use client";

import { useTranslations } from "next-intl";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 01: the mission. The document's why, stated before the instrument is
 * introduced. A numbered opener (mono eyebrow, Space Grotesk thesis, serif lead),
 * two short serif paragraphs, and three principle rows on a hairline stack. The
 * register echoes the founder's CUSP voice re-cadenced (principle-led, implement
 * over propose, grassroots and systemic). Mission language is aspiration and
 * principle only, never a data or impact claim; the demo-data caveat stays honest.
 */
const PRINCIPLES = ["measure", "implement", "together"] as const;

export default function MissionSection() {
  const t = useTranslations("landing.mission");

  return (
    <Section id="mission" tone="sunken" rule>
      <Measure width="outset">
        <SectionHeader
          index="01"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="text" className="mt-12">
        <div className="space-y-5 font-serif text-[1.08rem] leading-[1.6] text-ink">
          <p>{t("body.p1")}</p>
          <p>{t("body.p2")}</p>
        </div>

        <dl className="mt-12 border-t border-hairline">
          {PRINCIPLES.map((key) => (
            <div key={key} className="border-b border-hairline py-6">
              <dt className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                {t(`principles.${key}.label`)}
              </dt>
              <dd className="mt-2 font-serif text-[1.02rem] leading-[1.55] text-ink-muted">
                {t(`principles.${key}.desc`)}
              </dd>
            </div>
          ))}
        </dl>
      </Measure>
    </Section>
  );
}
