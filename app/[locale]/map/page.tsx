import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import AuditMap from "@/components/AuditMap";
import DemoBanner from "@/components/DemoBanner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function MapPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The map surface opens directly into the full-bleed Escazú map — no chrome.
  const [segments, stats] = await Promise.all([getSegments(), getStats()]);

  return (
    <>
      <DemoBanner />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AuditMap segments={segments} stats={stats} />
      </main>
    </>
  );
}
