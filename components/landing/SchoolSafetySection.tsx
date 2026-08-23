import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type { SchoolsSummary } from "@/lib/school-report";
import Section from "@/components/ui/Section";
import Measure from "@/components/ui/Measure";
import SectionHeader from "@/components/ui/SectionHeader";

/**
 * Section 01: what StreetLens is for.
 *
 * The landing used to open on the instrument and reach the use case later. That
 * ordering was right when the instrument was the product; it is wrong now. A
 * street-quality score is a capability, and a capability does not tell anyone
 * why to care. The walk to school does, immediately, to a parent and to a
 * funder alike — so the pitch leads with it and the instrument becomes the
 * evidence rather than the headline.
 *
 * A server component, unlike its neighbours, because the figures here are LIVE:
 * how many schools are rated today, and how much street is still unrecorded.
 * Those two numbers are the honest state of the project, and hard-coding them
 * would be the exact dishonesty the standard exists to avoid.
 */
const POINTS = ["pointOne", "pointTwo", "pointThree"] as const;

export default async function SchoolSafetySection({
  locale,
  summary,
}: Readonly<{
  locale: Locale;
  summary: SchoolsSummary;
}>) {
  const t = await getTranslations({ locale, namespace: "landing.schoolSafety" });

  const figures: { value: string; label: string }[] = [
    { value: String(summary.schools), label: t("statSchools") },
    { value: String(summary.scored), label: t("statRated") },
    { value: String(summary.awaiting_data), label: t("statAwaiting") },
    {
      value: `${(summary.gap_length_m / 1000).toFixed(1)} km`,
      label: t("statGap"),
    },
  ];

  return (
    <Section id="school-safety" tone="sunken" rule>
      <Measure width="outset">
        <SectionHeader index="01" eyebrow={t("eyebrow")} title={t("title")} lead={t("body")} />
      </Measure>

      <Measure width="outset" className="mt-12 sm:mt-14">
        {/* The live state of the work, stated before the argument for it. The
            gap figure is deliberately given equal weight to the rated count:
            what is missing is as much the story as what is done. */}
        <dl className="grid grid-cols-2 gap-6 border-y border-hairline py-7 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="flex flex-col gap-1.5">
              <dd className="font-mono text-[1.75rem] font-medium leading-none tabular-nums text-ink">
                {f.value}
              </dd>
              <dt className="text-[11.5px] leading-tight text-ink-muted">{f.label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {POINTS.map((key) => (
            <article key={key} className="flex flex-col gap-2.5">
              <h3 className="text-balance font-display text-[1.05rem] font-semibold leading-snug text-ink">
                {t(`${key}.title`)}
              </h3>
              <p className="font-serif text-[1rem] leading-[1.6] text-ink-muted">
                {t(`${key}.body`)}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href={`/${locale}/schools`}
            className="flex items-center gap-1.5 font-mono text-[12.5px] font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {t("ctaStandard")} <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
          <Link
            href={`/${locale}/map`}
            className="flex items-center gap-1.5 font-mono text-[12.5px] font-medium text-ink underline-offset-4 hover:underline"
          >
            {t("ctaMap")} <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
        </div>
      </Measure>
    </Section>
  );
}
