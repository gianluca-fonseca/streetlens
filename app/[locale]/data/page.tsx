import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import CivicChrome from "@/components/civic/CivicChrome";
import { OPEN_DATA_CSV_COLUMNS, OPEN_DATA_LICENSE } from "@/lib/open-data";
import { MUNICIPALITY } from "@/lib/municipality";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "data.meta" });
  return {
    title: t("title", { municipality: MUNICIPALITY.name }),
    description: t("description"),
  };
}

export default async function DataPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "data" });

  return (
    <CivicChrome locale={locale} homeLabel={t("home")}>
      <article className="mt-4 flex flex-col gap-8">
        <header>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-ink-display sm:text-[2rem]">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-[40rem] font-serif text-[1.05rem] leading-relaxed text-ink-muted">
            {t("lead", { municipality: MUNICIPALITY.name })}
          </p>
        </header>

        <section aria-labelledby="data-download-heading">
          <h2
            id="data-download-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("downloadHeading")}
          </h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {/* File downloads — plain anchors (not next/link page navigation). */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/open-data/geojson"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-ink px-4 py-2 text-[13px] font-medium text-surface transition-colors hover:bg-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("downloadGeojson")}
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/open-data/csv"
              className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-surface-elevated px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("downloadCsv")}
            </a>
          </div>
        </section>

        <section aria-labelledby="data-license-heading">
          <h2
            id="data-license-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("licenseHeading")}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] text-ink">
            <li>
              {t("licenseGeometry")}: {OPEN_DATA_LICENSE.geometry}
            </li>
            <li>
              {t("licenseScores")}: {OPEN_DATA_LICENSE.scores}
            </li>
            <li>{t("licenseNote")}</li>
          </ul>
        </section>

        <section aria-labelledby="data-fields-heading">
          <h2
            id="data-fields-heading"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted"
          >
            {t("fieldsHeading")}
          </h2>
          <p className="mt-2 text-[13px] text-ink-muted">{t("fieldsLead")}</p>
          <div className="mt-3 overflow-x-auto rounded-[6px] border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-mono uppercase tracking-[0.12em] text-ink-muted">
                  <th className="px-3 py-2 font-semibold">{t("colField")}</th>
                  <th className="px-3 py-2 font-semibold">{t("colDesc")}</th>
                </tr>
              </thead>
              <tbody>
                {OPEN_DATA_CSV_COLUMNS.map((field) => (
                  <tr
                    key={field}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-ink">{field}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {t(`fields.${field}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-muted">{t("privacyNote")}</p>
        </section>
      </article>
    </CivicChrome>
  );
}
