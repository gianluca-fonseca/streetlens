import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import {
  captureBacklog,
  getSchoolReports,
  interventionList,
  leaderboard,
  summarizeSchools,
} from "@/lib/school-report";
import {
  COVERAGE,
  LEY_7600_MIN_SCORE,
  SCHOOL_ZONE,
  SEAL_VALID_MONTHS,
  TIER_CUTS,
} from "@/lib/school-score";
import { MUNICIPALITY } from "@/lib/municipality";
import { buildPageMetadata } from "@/lib/site";
import CivicChrome from "@/components/civic/CivicChrome";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "schoolsPage.meta" });
  return buildPageMetadata({
    locale,
    path: "/schools",
    title: t("title", { municipality: MUNICIPALITY.name }),
    description: t("description", { municipality: MUNICIPALITY.name }),
  });
}

/**
 * The Escuela Segura standard, and every school measured against it.
 *
 * Structured as an argument rather than a dashboard: why school zones, what the
 * standard is, then the table. A reader who only wants the ranking can scroll
 * to it, but a partner deciding whether to fund anything needs the reasoning
 * first, and the reasoning is what makes the ranking defensible.
 */
export default async function SchoolsPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "schoolsPage" });
  const ts = await getTranslations({ locale, namespace: "schools" });

  const demo = await demoDataEnabled();
  const reports = await getSchoolReports(demo);
  const summary = summarizeSchools(reports);
  const ranked = leaderboard(reports);
  const priority = interventionList(reports, 10);
  const backlog = captureBacklog(reports).slice(0, 8);

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(100 * v)}%`);

  return (
    /* CivicChrome, not a bare <main>: the locale layout keeps <body> at
       overflow-hidden for the full-bleed map, so every long public page has to
       own its own scroll container. */
    <CivicChrome locale={locale} homeLabel={t("home")}>
      <div className="flex w-full flex-col gap-14 py-10 sm:py-14">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("eyebrow")}
        </p>
        <h1 className="max-w-[16ch] text-balance font-display text-[clamp(2rem,6vw,3.1rem)] font-semibold leading-[1.05] tracking-tight text-ink">
          {t("title")}
        </h1>
        <p className="max-w-[54ch] font-serif text-[1.0625rem] leading-relaxed text-neutral-strong">
          {t("standfirst", { municipality: MUNICIPALITY.name })}
        </p>

        <dl className="mt-2 grid grid-cols-2 gap-4 border-y border-border py-5 sm:grid-cols-4">
          {[
            [String(summary.schools), t("statSchools")],
            [String(summary.scored), t("statScored")],
            [String(summary.awaiting_data), t("statAwaiting")],
            [`${(summary.gap_length_m / 1000).toFixed(1)} km`, t("statToRecord")],
          ].map(([value, label]) => (
            <div key={label} className="flex flex-col gap-1">
              <dd className="font-mono text-[1.6rem] font-medium leading-none tabular-nums text-ink">
                {value}
              </dd>
              <dt className="text-[11.5px] leading-tight text-neutral-strong">{label}</dt>
            </div>
          ))}
        </dl>

        <Link
          href={`/${locale}/map`}
          className="flex w-max items-center gap-1.5 font-mono text-[12.5px] font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {t("openMap")} <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
        </Link>
      </header>

      {/* Why school zones — the equity and precedent argument. */}
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[1.45rem] font-semibold tracking-tight text-ink">
          {t("why.title")}
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {(["equity", "precedent", "tractable"] as const).map((key) => (
            <article key={key} className="flex flex-col gap-2">
              <h3 className="text-balance font-display text-[1rem] font-semibold leading-snug text-ink">
                {t(`why.${key}.title`)}
              </h3>
              <p className="text-[13px] leading-relaxed text-neutral-strong">
                {t(`why.${key}.body`)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* The standard. Numbers interpolated from the constants themselves, so
          the page cannot drift from the arithmetic it describes. */}
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[1.45rem] font-semibold tracking-tight text-ink">
          {t("standard.title")}
        </h2>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {/* Titles and bodies are addressed by literal key rather than built
              from a variable, so next-intl can still typecheck every one of
              them against the message catalogue. The numbers come from the
              constants themselves, so this page cannot drift from the
              arithmetic it describes. */}
          {[
            {
              key: "zone",
              title: t("standard.zoneTitle"),
              body: t("standard.zoneBody", {
                gate: SCHOOL_ZONE.GATE_RADIUS_M,
                walk: SCHOOL_ZONE.WALK_RADIUS_M,
              }),
            },
            { key: "score", title: t("standard.scoreTitle"), body: t("standard.scoreBody") },
            {
              key: "coverage",
              title: t("standard.coverageTitle"),
              body: t("standard.coverageBody", {
                minCoverage: Math.round(100 * COVERAGE.MIN_FOR_SCORE),
              }),
            },
            { key: "veto", title: t("standard.vetoTitle"), body: t("standard.vetoBody") },
            {
              key: "seal",
              title: t("standard.sealTitle"),
              body: t("standard.sealBody", {
                minSeal: Math.round(100 * COVERAGE.MIN_FOR_SEAL),
                months: SEAL_VALID_MONTHS,
              }),
            },
          ].map((row) => (
            <article key={row.key} className="flex flex-col gap-2">
              <h3 className="font-display text-[1rem] font-semibold leading-snug text-ink">
                {row.title}
              </h3>
              <p className="text-[13px] leading-relaxed text-neutral-strong">{row.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-strong">
            {t("tiersTitle")}
          </h3>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {[
              { tier: "sin_datos", range: `< ${Math.round(100 * COVERAGE.MIN_FOR_SCORE)}% surveyed` },
              ...TIER_CUTS.slice().reverse().map((cut, i, arr) => ({
                tier: cut.tier,
                range:
                  i === arr.length - 1
                    ? `≥ ${Math.round(100 * cut.min)}%`
                    : `${Math.round(100 * cut.min)}–${Math.round(100 * arr[i + 1].min) - 1}%`,
              })),
            ].map((row) => (
              <li key={row.tier} className="flex items-baseline justify-between gap-4 py-2.5">
                <span className="text-[13.5px] font-medium text-ink">
                  {ts(`tier.${row.tier}` as "tier.critico")}
                </span>
                <span className="font-mono text-[11.5px] tabular-nums text-neutral-strong">
                  {row.range}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] leading-snug text-neutral-strong">
            Ley 7600 accessibility minimum: {LEY_7600_MIN_SCORE}/100 per segment.
          </p>
        </div>
      </section>

      {/* The leaderboard. */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[1.45rem] font-semibold tracking-tight text-ink">
          {t("leaderboardTitle")}
        </h2>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-neutral-strong">
          {t("leaderboardNote")}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border-strong text-left font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-strong">
                <th scope="col" className="py-2 pr-3">#</th>
                <th scope="col" className="py-2 pr-3">{t("columns.school")}</th>
                <th scope="col" className="py-2 pr-3">{t("columns.sector")}</th>
                <th scope="col" className="py-2 pr-3">{t("columns.tier")}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t("columns.compliance")}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t("columns.score")}</th>
                <th scope="col" className="py-2 pr-3 text-right">{t("columns.coverage")}</th>
                <th scope="col" className="py-2 text-right">{t("columns.toRecord")}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const isRanked = typeof r.published.score === "number";
                return (
                  <tr key={r.school.id} className="border-b border-border">
                    <td className="py-2 pr-3 font-mono text-[11px] tabular-nums text-neutral-strong">
                      {isRanked ? i + 1 : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/${locale}/map?school=${r.school.id}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {r.display_name}
                      </Link>
                      {r.published.overridden && (
                        <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent-text">
                          {ts("overriddenLabel")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[10.5px] text-neutral-strong">
                      {ts(`sector.${r.school.sector}`)}
                    </td>
                    <td className="py-2 pr-3">{ts(`tier.${r.published.tier}` as "tier.critico")}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">
                      {pct(r.published.compliance)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-strong">
                      {r.published.score ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-strong">
                      {pct(r.computed.coverage)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-accent-text">
                      {r.gaps.length ? `${Math.round(r.gap_length_m)} m` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Priority + backlog, side by side: the two lists a partner asks for. */}
      <section className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-[1.2rem] font-semibold tracking-tight text-ink">
            {t("priorityTitle")}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-neutral-strong">{t("priorityNote")}</p>
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {priority.map((r, i) => (
              <li key={r.school.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[10.5px] tabular-nums text-neutral-strong">
                    {i + 1}
                  </span>
                  <span className="truncate text-[13px] text-ink">{r.display_name}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent-text">
                  {r.priority.rank_score}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-[1.2rem] font-semibold tracking-tight text-ink">
            {t("backlogTitle")}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-neutral-strong">{t("backlogNote")}</p>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {backlog.map((b) => (
              <li
                key={b.report.school.id}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="truncate text-[13px] text-ink">{b.report.display_name}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent-text">
                  {Math.round(b.report.gap_length_m)} m
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-8">
        <h2 className="font-display text-[1.2rem] font-semibold tracking-tight text-ink">
          {t("provenanceTitle")}
        </h2>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-neutral-strong">
          {t("provenanceBody")}
        </p>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-neutral-strong">
          {t("crashNote")}
        </p>
      </section>
      </div>
    </CivicChrome>
  );
}
