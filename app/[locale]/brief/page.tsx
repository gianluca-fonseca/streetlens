import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import CivicChrome from "@/components/civic/CivicChrome";
import PrintButton from "@/components/civic/PrintButton";
import { buildLeyBriefSummary } from "@/lib/ley-brief";
import { MUNICIPALITY } from "@/lib/municipality";
import { getSegments } from "@/lib/segments";
import { LEY_7600_MIN_SCORE } from "@/lib/types";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "brief.meta" });
  return {
    title: t("title", { municipality: MUNICIPALITY.name }),
    description: t("description", { municipality: MUNICIPALITY.name }),
  };
}

export default async function BriefPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "brief" });
  const segments = await getSegments();
  const summary = buildLeyBriefSummary(segments);

  return (
    <CivicChrome
      locale={locale}
      homeLabel={t("home")}
      actions={<PrintButton label={t("downloadPdf")} />}
    >
      <article className="mt-4 flex flex-col gap-8">
        <header>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-ink-display sm:text-[2rem]">
            {t("title", { municipality: MUNICIPALITY.name })}
          </h1>
          <p className="mt-2 max-w-[40rem] font-serif text-[1.05rem] leading-relaxed text-ink-muted">
            {t("lead", {
              municipality: MUNICIPALITY.name,
              threshold: LEY_7600_MIN_SCORE,
            })}
          </p>
        </header>

        <aside
          className="rounded-[6px] border border-border bg-surface-sunken px-4 py-3 text-[13px] leading-relaxed text-ink"
          role="note"
        >
          <strong className="font-semibold">{t("disclaimerTitle")}</strong>{" "}
          {t("disclaimer")}
        </aside>

        <section aria-labelledby="brief-summary-heading">
          <h2
            id="brief-summary-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("summaryHeading")}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statObserved")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {summary.observed}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statFailing")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {summary.failing}
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statFailRate")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {summary.failRatePct}%
              </dd>
            </div>
            <div className="rounded-[6px] border border-border bg-surface-elevated px-3 py-3">
              <dt className="text-[11px] text-ink-muted">{t("statThreshold")}</dt>
              <dd className="mt-1 font-mono text-[1.35rem] font-semibold text-ink-display">
                {summary.threshold}
              </dd>
            </div>
          </dl>
          {summary.observed === 0 ? (
            <p className="mt-3 text-[13px] text-ink-muted">{t("empty")}</p>
          ) : null}
        </section>

        <section aria-labelledby="brief-districts-heading">
          <h2
            id="brief-districts-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("districtsHeading")}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-[6px] border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-mono uppercase tracking-[0.12em] text-ink-muted">
                  <th className="px-3 py-2 font-semibold">{t("colDistrict")}</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {t("colObserved")}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {t("colFailing")}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {t("colFailRate")}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {t("colMean")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.districts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-ink-muted"
                    >
                      {t("empty")}
                    </td>
                  </tr>
                ) : (
                  summary.districts.map((d) => (
                    <tr
                      key={d.district}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-3 py-2 text-ink">{d.district}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {d.observed}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {d.failing}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {d.failRatePct}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {d.meanAccessibility ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="brief-worst-heading">
          <h2
            id="brief-worst-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("worstHeading")}
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px]">
            {summary.worstCorridors.length === 0 ? (
              <li className="text-ink-muted list-none pl-0 -ml-5">
                {t("empty")}
              </li>
            ) : (
              summary.worstCorridors.map((c) => (
                <li key={c.id} className="text-ink">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {c.district} · {t("scoreLabel")}{" "}
                    <span className="font-mono">{c.accessibility}</span>
                    {" · "}
                    {t(`source.${c.source}`)}
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>

        <section aria-labelledby="brief-method-heading">
          <h2
            id="brief-method-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("methodHeading")}
          </h2>
          <p className="mt-2 font-serif text-[1rem] leading-relaxed text-ink-muted">
            {t("methodBody", { threshold: LEY_7600_MIN_SCORE })}
          </p>
        </section>
      </article>
    </CivicChrome>
  );
}
