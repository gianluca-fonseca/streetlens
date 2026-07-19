import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import { showDemoData } from "@/lib/demo-flag";
import AuditMap from "@/components/AuditMap";
import DemoBanner from "@/components/DemoBanner";
import MapChrome from "@/components/MapChrome";

export const revalidate = 300;

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
  searchParams,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ contribute?: string; segment?: string }>;
}>) {
  const { locale } = await params;
  const { contribute, segment } = await searchParams;
  setRequestLocale(locale);

  const [segments, stats] = await Promise.all([getSegments(), getStats()]);
  const openContribute = contribute === "1";
  const initialSegmentId = segment?.trim() || undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showDemoData() ? <DemoBanner /> : null}
      <MapChrome />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AuditMap
          segments={segments}
          stats={stats}
          openContributeOnMount={openContribute}
          initialSegmentId={initialSegmentId}
        />
      </main>
    </div>
  );
}
