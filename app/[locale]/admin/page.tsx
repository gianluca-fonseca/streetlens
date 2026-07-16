import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import { getSubmissionCounts } from "@/lib/submissions";
import AdminHeader from "@/components/admin/AdminHeader";
import StatTiles, { type StatTile } from "@/components/admin/StatTiles";

// Admin figures must always reflect the live dataset, never a build snapshot.
export const dynamic = "force-dynamic";

// rev-5 status tokens (flip per theme). Approved is neutral ink (no green in
// rev-5), so its tile carries no accent.
const AMBER = "var(--amber)";
const CLAY = "var(--clay)";

export default async function AdminDashboardPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.dashboard" });

  const [stats, counts, segments] = await Promise.all([
    getStats(),
    getSubmissionCounts(),
    getSegments(),
  ]);

  // Per-district breakdown (count + average overall score).
  const byDistrict = new Map<string, { count: number; sum: number }>();
  for (const f of segments.features) {
    const key = f.properties.district;
    const entry = byDistrict.get(key) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += f.properties.score_overall;
    byDistrict.set(key, entry);
  }
  const districts = [...byDistrict.entries()]
    .map(([name, { count, sum }]) => ({
      name,
      count,
      avg: count ? Math.round(sum / count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const datasetTiles: StatTile[] = [
    { key: "segments", value: String(stats.segments), label: t("segments") },
    { key: "km", value: stats.km.toFixed(1), label: t("km") },
    { key: "coverage", value: `${stats.coveragePct}%`, label: t("coverage") },
    {
      key: "hero",
      value: `${stats.heroPct}%`,
      label: t("hero"),
      accent: CLAY,
    },
  ];

  const submissionTiles: StatTile[] = [
    {
      key: "pending",
      value: String(counts.pending),
      label: t("pending"),
      accent: AMBER,
    },
    {
      key: "approved",
      value: String(counts.approved),
      label: t("approved"),
    },
    {
      key: "rejected",
      value: String(counts.rejected),
      label: t("rejected"),
      accent: CLAY,
    },
  ];

  return (
    <>
      <AdminHeader locale={locale} active="dashboard" />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-strong">
            {t("subtitle")}
          </p>
        </div>

        <StatTiles tiles={datasetTiles} />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("pending")} · {t("approved")} · {t("rejected")}
            </h2>
            <Link
              href={`/${locale}/admin/queue`}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-border-strong"
            >
              <ListChecks size={14} strokeWidth={1.75} aria-hidden="true" />
              {t("queueLink")}
            </Link>
          </div>
          <StatTiles tiles={submissionTiles} />
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t("districtHeading")}
          </h2>
          <div className="overflow-x-auto rounded-[8px] border border-border bg-surface-elevated shadow-[var(--shadow-panel)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-mono uppercase tracking-[0.14em] text-neutral-strong">
                  <th className="px-4 py-2.5 font-semibold">
                    {t("colDistrict")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    {t("colSegments")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    {t("colAvg")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {districts.map((d) => (
                  <tr
                    key={d.name}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-2.5 text-ink">{d.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink">
                      {d.count}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink">
                      {d.avg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11.5px] leading-snug text-neutral-strong">
          {t("demoNote")}
        </p>
      </main>
    </>
  );
}
