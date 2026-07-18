"use client";

import { useTranslations } from "next-intl";
import { showDemoData } from "@/lib/demo-flag";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";
import Sidenote from "@/components/ui/Sidenote";

/**
 * Section 02 — the accountability gap, rebuilt as thesis and evidence. The old
 * dark imagery band is retired: a centered thesis, a left-aligned serif argument
 * carrying two margin citations (Ley 7600, COSEVI), then the three anchoring
 * figures as a hairline mono table. Only the demo figure is caveated; the two
 * Costa Rican anchors are real and sourced.
 */
export default function GapSection({
  heroPct,
}: Readonly<{
  heroPct: number;
}>) {
  const t = useTranslations("landing.gap");

  const stats = [
    { key: "1", value: t("stat1Value"), label: t("stat1Label"), note: t("stat1Note") },
    { key: "2", value: t("stat2Value"), label: t("stat2Label"), note: t("stat2Note") },
    // stat3 is the pilot's own fail rate; with demo off it degrades to 0% and its
    // "demo figure" caveat no longer applies, so it drops. The two Costa Rican
    // anchors above are real and always keep their sourced notes.
    ...(showDemoData()
      ? [
          {
            key: "3",
            value: `${heroPct}%`,
            label: t("stat3Label"),
            note: t("stat3Note"),
          },
        ]
      : []),
  ];

  return (
    <Section id="gap" tone="sunken" rule>
      <Measure width="outset">
        <SectionHeader
          index="03"
          eyebrow={t("eyebrow")}
          title={t("heading")}
          lead={t("lead")}
        />
      </Measure>

      <Measure width="text" className="mt-12">
        <p className="font-serif text-[1.08rem] leading-[1.7] text-ink">
          {t.rich("body", {
            ley: (chunks) => <Sidenote number={1}>{chunks}</Sidenote>,
            cosevi: (chunks) => <Sidenote number={2}>{chunks}</Sidenote>,
          })}
        </p>
      </Measure>

      <Measure width="page" className="clear-both mt-14">
        <dl
          className={`grid gap-px overflow-hidden rounded-[4px] border border-hairline bg-hairline ${stats.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
        >
          {stats.map((s) => (
            <div key={s.key} className="flex flex-col bg-surface p-6 sm:p-7">
              <dd className="font-mono text-[clamp(1.7rem,3.4vw,2.15rem)] font-medium leading-none tracking-tight text-ink-display">
                {s.value}
              </dd>
              <dt className="mt-3 text-[0.95rem] font-medium leading-snug text-ink">
                {s.label}
              </dt>
              {s.note ? (
                <p className="mt-2 text-[12.5px] leading-snug text-ink-muted">
                  {s.note}
                </p>
              ) : null}
            </div>
          ))}
        </dl>
      </Measure>
    </Section>
  );
}
