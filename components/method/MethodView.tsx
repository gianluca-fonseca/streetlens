import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LEY_7600_MIN_SCORE } from "@/lib/types";
import { getMunicipality } from "@/lib/municipality";
import Measure from "@/components/ui/Measure";
import PublicDocChrome from "@/components/insights/PublicDocChrome";

export default async function MethodView({
  locale,
}: Readonly<{ locale: Locale }>) {
  const t = await getTranslations({ locale, namespace: "methodPage" });
  const ti = await getTranslations({ locale, namespace: "insights" });
  const municipality = getMunicipality();

  const lenses = ["accessibility", "drainage", "shade", "bike", "overall"] as const;
  const lineage = ["maps", "lanamme", "ley", "osm"] as const;
  const bins = [
    { key: "excellent", range: "80–100" },
    { key: "good", range: "60–79" },
    { key: "fair", range: "40–59" },
    { key: "poor", range: "0–39" },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface text-ink">
      <PublicDocChrome
        homeLabel={ti("chrome.home")}
        insightsLabel={ti("chrome.insights")}
        methodLabel={ti("chrome.method")}
        rubricLabel={ti("chrome.rubric")}
        mapLabel={ti("chrome.map")}
        active="method"
      />

      <main className="pb-16">
        <Measure width="outset" className="pt-10 sm:pt-14">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 max-w-[24ch] font-display text-[clamp(1.6rem,3.2vw,2.15rem)] font-bold leading-[1.12] tracking-[-0.02em] text-ink-display text-balance">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[52ch] font-serif text-[1.05rem] leading-[1.6] text-ink-muted text-pretty">
            {t("lead")}
          </p>
        </Measure>

        <Measure width="text" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("honesty.heading")}
          </h2>
          <p className="mt-3 font-serif text-[1.05rem] leading-[1.7] text-ink">
            {t("honesty.body")}
          </p>
          <ul className="mt-4 space-y-2 border-l-2 border-hairline pl-4 text-[14px] leading-relaxed text-ink-muted">
            <li>{t("honesty.camera")}</li>
            <li>{t("honesty.audit")}</li>
            <li>{t("honesty.neverMerge")}</li>
          </ul>
        </Measure>

        <Measure width="text" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("lineage.heading")}
          </h2>
          <p className="mt-3 font-serif text-[1.05rem] leading-[1.7] text-ink">
            {t("lineage.body")}
          </p>
          <ul className="mt-4 space-y-3">
            {lineage.map((key) => (
              <li key={key} className="border-t border-hairline pt-3">
                <p className="font-display text-[1.05rem] font-semibold text-ink-display">
                  {t(`lineage.items.${key}.title`)}
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
                  {t(`lineage.items.${key}.desc`)}
                </p>
              </li>
            ))}
          </ul>
        </Measure>

        <Measure width="page" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("lenses.heading")}
          </h2>
          <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-ink-muted">
            {t("lenses.support", { municipality: municipality.name })}
          </p>
          <div className="mt-5 grid gap-px overflow-hidden rounded-[4px] border border-hairline bg-hairline sm:grid-cols-2">
            {lenses.map((key) => (
              <div key={key} className="bg-surface p-5">
                <h3 className="font-display text-[1.05rem] font-semibold text-ink-display">
                  {t(`lenses.items.${key}.title`)}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
                  {t(`lenses.items.${key}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </Measure>

        <Measure width="text" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("ley.heading")}
          </h2>
          <p className="mt-3 font-serif text-[1.05rem] leading-[1.7] text-ink">
            {t("ley.body", { threshold: LEY_7600_MIN_SCORE })}
          </p>
          <ul className="mt-4 space-y-2 text-[14px] leading-relaxed text-ink-muted">
            <li>{t("ley.art125")}</li>
            <li>{t("ley.art126")}</li>
            <li>{t("ley.art127")}</li>
          </ul>
        </Measure>

        <Measure width="outset" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("bins.heading")}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
            {t("bins.support")}
          </p>
          <div className="mt-5 overflow-hidden rounded-[4px] border border-hairline">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-hairline bg-surface-sunken font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-muted">
                  <th className="px-3 py-2.5 text-left font-semibold">
                    {t("bins.colBin")}
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    {t("bins.colRange")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.key} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-2.5 text-ink">{t(`bins.${b.key}`)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink">
                      {b.range}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Measure>

        <Measure width="text" className="mt-12">
          <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.01em] text-ink-display">
            {t("reaudits.heading")}
          </h2>
          <p className="mt-3 font-serif text-[1.05rem] leading-[1.7] text-ink">
            {t("reaudits.body")}
          </p>
        </Measure>

        <Measure width="outset" className="mt-14">
          <div className="flex flex-wrap gap-4 border-t border-hairline pt-6 text-[13px]">
            <Link
              href="/rubric"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.rubric")}
            </Link>
            <Link
              href="/insights"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.insights")}
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
