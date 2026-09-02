import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import type { Locale } from "@/i18n/routing";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import {
  captureBacklog,
  getSchoolReports,
  interventionList,
  summarizeSchools,
} from "@/lib/school-report";
import AdminHeader from "@/components/admin/AdminHeader";
import StatTiles, { type StatTile } from "@/components/admin/StatTiles";

// Admin figures must always reflect the live dataset, never a build snapshot.
export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = {
  sin_datos: "Sin datos",
  critico: "Crítico",
  en_riesgo: "En riesgo",
  en_progreso: "En progreso",
  escuela_segura: "Escuela Segura",
};

/**
 * The schools desk.
 *
 * Ordered by INTERVENTION PRIORITY rather than by score, because the question
 * this page exists to answer is "what should we do next", and the worst school
 * is not automatically the best place to spend. Two side lists carry the other
 * two standing questions: where a camera should go, and which ten schools to
 * put in front of a funder.
 */
export default async function AdminSchoolsPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const demo = await demoDataEnabled();
  const reports = await getSchoolReports(demo);
  const summary = summarizeSchools(reports);
  const priority = interventionList(reports, 10);
  const backlog = captureBacklog(reports).slice(0, 6);

  const tiles: StatTile[] = [
    { key: "schools", value: String(summary.schools), label: "Schools" },
    { key: "scored", value: String(summary.scored), label: "Scored" },
    { key: "awaiting", value: String(summary.awaiting_data), label: "Awaiting data" },
    { key: "coverage", value: `${Math.round(100 * summary.coverage)}%`, label: "Zone coverage" },
    { key: "gap", value: `${(summary.gap_length_m / 1000).toFixed(1)} km`, label: "Still to record" },
  ];

  const ordered = [...reports].sort(
    (a, b) => (b.priority.rank_score ?? -1) - (a.priority.rank_score ?? -1),
  );

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader locale={locale} active="schools" />
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-6 px-4 pb-16">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-strong">
            Escuela Segura
          </p>
          <h1 className="font-display text-[1.6rem] text-ink">School zones</h1>
          <p className="max-w-[52em] text-[13px] leading-relaxed text-neutral-strong">
            Every school in the canton, scored from the streets inside its walkshed. Scores
            recompute from live segment readings on every load; nothing here is a stored
            snapshot.
          </p>
        </header>

        <StatTiles tiles={tiles} />

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[1.05rem] text-ink">Where a camera should go next</h2>
          <p className="text-[11.5px] text-neutral-strong">
            Ranked by what a session there would add, with gate-ring metres counted double.
          </p>
          <ul className="flex flex-wrap gap-2">
            {backlog.map((b) => (
              <li key={b.report.school.id}>
                <Link
                  href={`/${locale}/admin/schools/${b.report.school.id}`}
                  className="flex items-baseline gap-2 rounded-[6px] border border-border px-2.5 py-1.5 text-[12px] text-ink hover:border-ink"
                >
                  <span className="truncate">{b.report.display_name}</span>
                  <span className="font-mono text-[10.5px] text-accent-text">
                    {Math.round(b.report.gap_length_m)} m
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[1.05rem] text-ink">
            Top {priority.length} for intervention
          </h2>
          <p className="text-[11.5px] text-neutral-strong">
            Deficit × exposure × how much of the fix sits in the cheap gate ring.
          </p>
          <ol className="flex flex-wrap gap-2">
            {priority.map((r, i) => (
              <li key={r.school.id}>
                <Link
                  href={`/${locale}/admin/schools/${r.school.id}`}
                  className="flex items-baseline gap-2 rounded-[6px] border border-border px-2.5 py-1.5 text-[12px] text-ink hover:border-ink"
                >
                  <span className="font-mono text-[10.5px] text-neutral-strong">{i + 1}</span>
                  <span className="truncate">{r.display_name}</span>
                  <span className="font-mono text-[10.5px] text-accent-text">
                    {r.priority.rank_score}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[1.05rem] text-ink">All schools</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border-strong text-left font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-strong">
                  <th scope="col" className="py-2 pr-3">School</th>
                  <th scope="col" className="py-2 pr-3">Sector</th>
                  <th scope="col" className="py-2 pr-3">Tier</th>
                  <th scope="col" className="py-2 pr-3 text-right">Score</th>
                  <th scope="col" className="py-2 pr-3 text-right">Ley 7600</th>
                  <th scope="col" className="py-2 pr-3 text-right">Coverage</th>
                  <th scope="col" className="py-2 pr-3 text-right">To record</th>
                  <th scope="col" className="py-2 text-right">Priority</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => (
                  <tr key={r.school.id} className="border-b border-border">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/${locale}/admin/schools/${r.school.id}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {r.display_name}
                      </Link>
                      {r.published.overridden && (
                        <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent-text">
                          override
                        </span>
                      )}
                      {r.computed.gate_veto && (
                        <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent-text">
                          veto
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[10.5px] text-neutral-strong">
                      {r.school.sector === "public" ? "público" : "privado"}
                    </td>
                    <td className="py-2 pr-3">{TIER_LABEL[r.published.tier]}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink">
                      {r.published.score ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-strong">
                      {r.published.compliance === null
                        ? "—"
                        : `${Math.round(100 * r.published.compliance)}%`}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-strong">
                      {Math.round(100 * r.computed.coverage)}%
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-accent-text">
                      {r.gaps.length ? `${Math.round(r.gap_length_m)} m` : "—"}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-ink">
                      {r.priority.rank_score ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
