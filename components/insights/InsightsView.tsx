import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatCvCoveragePct, formatProvenanceDate } from "@/lib/cv-provenance";
import type { InsightsSnapshot } from "@/lib/insights-data";
import { insightSegmentHref } from "@/lib/segment-links";
import Measure from "@/components/ui/Measure";
import ProvenanceNote from "@/components/ProvenanceNote";
import SvgBarChart from "@/components/insights/SvgBarChart";
import SvgSparkline from "@/components/insights/SvgSparkline";
import PublicDocChrome from "@/components/insights/PublicDocChrome";

const BIN_COLORS: Record<string, string> = {
  excellent: "#056E48",
  good: "#5B8C3E",
  fair: "#CE4D02",
  poor: "#F45E53",
};

export default async function InsightsView({
  locale,
  data,
}: Readonly<{
  locale: Locale;
  data: InsightsSnapshot;
}>) {
  const t = await getTranslations({ locale, namespace: "insights" });
  const tl = await getTranslations({ locale, namespace: "layers" });
  const tb = await getTranslations({ locale, namespace: "legend.bins" });
  const { stats, municipality, districts, worstStreets, distributions, timeline, coverage } =
    data;

  const cvPct = formatCvCoveragePct(stats.cvCoveragePct, locale);
  const coveragePctLabel = formatCvCoveragePct(coverage.observedPct, locale);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface text-ink">
      <PublicDocChrome
        homeLabel={t("chrome.home")}
        insightsLabel={t("chrome.insights")}
        methodLabel={t("chrome.method")}
        rubricLabel={t("chrome.rubric")}
        mapLabel={t("chrome.map")}
        active="insights"
      />

      <main className="pb-16">
        <Measure width="outset" className="pt-10 sm:pt-14">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("eyebrow", { municipality: municipality.name })}
          </p>
          <h1 className="mt-3 max-w-[22ch] font-display text-[clamp(1.6rem,3.2vw,2.15rem)] font-bold leading-[1.12] tracking-[-0.02em] text-ink-display text-balance">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[52ch] font-serif text-[1.05rem] leading-[1.6] text-ink-muted text-pretty">
            {t("lead")}
          </p>
          <p className="mt-4 rounded-[2px] border border-hairline bg-paper-white px-3 py-2 font-mono text-[11px] leading-snug text-ink-muted">
            {t("honesty")}
          </p>
          <ProvenanceNote stats={stats} className="mt-4" />
        </Measure>

        {/* Coverage progress */}
        <Measure width="page" className="mt-12">
          <section aria-labelledby="insights-coverage">
            <h2
              id="insights-coverage"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted"
            >
              {t("coverage.heading")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
              {t("coverage.support")}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <StatTile
                label={t("coverage.observedKm")}
                value={coverage.observedKm.toFixed(2)}
                unit="km"
                note={t("coverage.cameraLabel")}
              />
              <StatTile
                label={t("coverage.networkKm")}
                value={coverage.networkKm.toFixed(1)}
                unit="km"
                note={t("coverage.networkLabel")}
              />
              <StatTile
                label={t("coverage.pct")}
                value={coveragePctLabel ?? "0%"}
                note={t("coverage.cameraLabel")}
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <StatTile
                label={t("coverage.cvSegments")}
                value={String(stats.cvSegments)}
                note={t("coverage.cameraLabel")}
              />
              <StatTile
                label={t("coverage.sessions")}
                value={String(stats.cvSessionsReviewed)}
                note={t("coverage.cameraLabel")}
              />
              <StatTile
                label={t("coverage.auditedSegments")}
                value={String(stats.segments)}
                note={t("coverage.auditedLabel")}
              />
            </div>
            <div className="mt-6 rounded-[4px] border border-hairline bg-paper-white p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                {t("coverage.overTime")}
              </p>
              <div className="mt-3">
                <SvgSparkline
                  ariaLabel={t("coverage.sparkAria")}
                  points={coverage.points.map((p) => ({
                    xLabel: p.day,
                    y: p.cumulativeKm,
                  }))}
                />
              </div>
              {coverage.points.length === 0 ? (
                <p className="mt-2 font-mono text-[11px] text-ink-muted">
                  {t("coverage.empty")}
                </p>
              ) : null}
            </div>
            {cvPct ? (
              <p className="mt-3 font-mono text-[11px] text-ink-muted">
                {t("coverage.statsLine", { pct: cvPct })}
              </p>
            ) : null}
          </section>
        </Measure>

        {/* District rollups */}
        <Measure width="page" className="mt-14">
          <section aria-labelledby="insights-districts">
            <h2
              id="insights-districts"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted"
            >
              {t("districts.heading")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
              {t("districts.support")}
            </p>
            {districts.length === 0 ? (
              <p className="mt-4 font-mono text-[12px] text-ink-muted">{t("districts.empty")}</p>
            ) : (
              <div className="mt-5 overflow-x-auto rounded-[4px] border border-hairline">
                <table className="w-full min-w-[40rem] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-sunken text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-muted">
                      <th className="px-3 py-2.5 font-semibold">{t("districts.colName")}</th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        {t("districts.colCvKm")}
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        {t("districts.colCvPct")}
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        {t("districts.colMean")}
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        {t("districts.colLey")}
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        {t("districts.colMap")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {districts.map((d) => (
                      <tr
                        key={d.name}
                        className="border-b border-hairline last:border-b-0"
                      >
                        <td className="px-3 py-2.5 text-ink">
                          <span className="font-medium">{d.name}</span>
                          <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                            {t("districts.segmentMeta", {
                              count: d.segmentCount,
                              cv: d.cvSegmentCount,
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {d.cvKm.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {formatCvCoveragePct(d.cvCoveragePct, locale) ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {d.meanCvOverall ?? "—"}
                          <span className="block text-[10px] text-ink-muted">
                            {t("districts.cameraMean")}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-ink">
                          {d.auditedLeyFailPct === null
                            ? "—"
                            : `${d.auditedLeyFailPct}%`}
                          <span className="block text-[10px] text-ink-muted">
                            {t("districts.auditedOnly")}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link
                            href={`/map?district=${encodeURIComponent(d.name)}`}
                            className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px] hover:text-ink-display"
                          >
                            {t("districts.openMap")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </Measure>

        {/* Worst streets */}
        <Measure width="page" className="mt-14">
          <section aria-labelledby="insights-worst">
            <h2
              id="insights-worst"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted"
            >
              {t("worst.heading")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
              {t("worst.support")}
            </p>
            {worstStreets.length === 0 ? (
              <p className="mt-4 rounded-[4px] border border-hairline bg-paper-white px-3 py-3 font-mono text-[12px] text-ink-muted">
                {t("worst.empty")}
              </p>
            ) : (
              <ol className="mt-5 divide-y divide-hairline rounded-[4px] border border-hairline">
                {worstStreets.map((s, i) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-3 sm:px-4"
                  >
                    <span className="w-6 shrink-0 font-mono text-[12px] text-ink-muted">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={s.href}
                        className="font-display text-[1.05rem] font-semibold tracking-[-0.01em] text-ink-display underline-offset-[3px] hover:underline hover:decoration-accent hover:decoration-2"
                      >
                        {s.name}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                        {s.district}
                        {s.captured_on
                          ? ` · ${formatProvenanceDate(s.captured_on, locale) ?? s.captured_on.slice(0, 10)}`
                          : ""}
                        {" · "}
                        {t("worst.cameraBadge")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[1.15rem] font-semibold text-ink-display">
                        {s.score}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                        {tl("overall.short")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </Measure>

        {/* Lens distributions */}
        <Measure width="page" className="mt-14">
          <section aria-labelledby="insights-lenses">
            <h2
              id="insights-lenses"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted"
            >
              {t("lenses.heading")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
              {t("lenses.support")}
            </p>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {distributions.map((dist) => (
                <div
                  key={dist.layer}
                  className="rounded-[4px] border border-hairline bg-paper-white p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-[1.05rem] font-semibold text-ink-display">
                      {tl(`${dist.layer}.name`)}
                    </h3>
                    <span className="font-mono text-[11px] text-ink-muted">
                      {dist.mean === null
                        ? t("lenses.noMean")
                        : t("lenses.mean", { value: dist.mean })}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                    {t("lenses.cameraOnly", { count: dist.observed })}
                  </p>
                  <div className="mt-3">
                    <SvgBarChart
                      ariaLabel={t("lenses.chartAria", {
                        layer: tl(`${dist.layer}.name`),
                      })}
                      data={dist.bins.map((b) => ({
                        key: b.key,
                        label: tb(b.key),
                        value: b.count,
                        share: b.share,
                        color: BIN_COLORS[b.key],
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </Measure>

        {/* Observation timeline */}
        <Measure width="page" className="mt-14">
          <section aria-labelledby="insights-timeline">
            <h2
              id="insights-timeline"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted"
            >
              {t("timeline.heading")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
              {t("timeline.support")}
            </p>
            {timeline.length === 0 ? (
              <p className="mt-4 font-mono text-[12px] text-ink-muted">{t("timeline.empty")}</p>
            ) : (
              <ul className="mt-5 divide-y divide-hairline rounded-[4px] border border-hairline">
                {timeline.map((ev) => {
                  const firstId = ev.segmentIds[0];
                  const href = firstId
                    ? insightSegmentHref(firstId, "overall")
                    : "/map";
                  return (
                    <li key={ev.day} className="px-3 py-3 sm:px-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-mono text-[12px] font-medium text-ink">
                          {formatProvenanceDate(ev.captured_on, locale) ?? ev.day}
                        </p>
                        <p className="font-mono text-[11px] text-ink-muted">
                          {t("timeline.segments", { count: ev.segmentCount })}
                          {ev.meanOverall !== null
                            ? ` · ${t("timeline.mean", { value: ev.meanOverall })}`
                            : ""}
                        </p>
                      </div>
                      <p className="mt-1 text-[13px] text-ink">
                        {ev.streetNames.slice(0, 4).join(", ")}
                        {ev.streetNames.length > 4
                          ? t("timeline.more", {
                              count: ev.streetNames.length - 4,
                            })
                          : ""}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                        {ev.districts.join(" · ")} · {t("timeline.cameraBadge")}
                      </p>
                      <Link
                        href={href}
                        className="mt-2 inline-flex text-[12px] font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
                      >
                        {t("timeline.open")}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Measure>

        <Measure width="outset" className="mt-14">
          <div className="flex flex-wrap gap-4 border-t border-hairline pt-6 text-[13px]">
            <Link
              href="/method"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.method")}
            </Link>
            <Link
              href="/rubric"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.rubric")}
            </Link>
            <Link
              href="/map"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.map")}
            </Link>
          </div>
        </Measure>
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
  note,
}: Readonly<{
  label: string;
  value: string;
  unit?: string;
  note: string;
}>) {
  return (
    <div className="rounded-[4px] border border-hairline bg-paper-white px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-[1.35rem] font-semibold tracking-tight text-ink-display">
        {value}
        {unit ? (
          <span className="ml-1 text-[0.75rem] font-medium text-ink-muted">
            {unit}
          </span>
        ) : null}
      </p>
      <p className="mt-1 font-mono text-[10px] text-ink-muted">{note}</p>
    </div>
  );
}
