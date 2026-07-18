import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getInsightsSnapshot } from "@/lib/insights-data";
import InsightsView from "@/components/insights/InsightsView";
import DataDegradedBanner from "@/components/DataDegradedBanner";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "insights.meta" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function InsightsPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const data = await getInsightsSnapshot();

  return (
    <>
      {data.stats.dataRead?.degraded ? <DataDegradedBanner /> : null}
      <InsightsView locale={locale} data={data} />
    </>
  );
}
