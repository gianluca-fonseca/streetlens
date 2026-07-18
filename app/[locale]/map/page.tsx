import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import { showDemoData } from "@/lib/demo-flag";
import AuditMap from "@/components/AuditMap";
import DemoBanner from "@/components/DemoBanner";
import DataDegradedBanner from "@/components/DataDegradedBanner";

// ISR: the map is otherwise statically generated at build time, so a session an
// admin approves post-deploy (its CV observation lands in Postgres via the review
// RPC) would never appear until the next redeploy. Revalidate every 5 minutes so
// getSegments re-reads the live CV observations and the approval reaches the public
// map on its own. The per-process static file caches in lib/segments.ts hold only
// committed, immutable data, so they are safe across revalidations; the Supabase CV
// read has no such cache and is fresh each regeneration.
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
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The map surface opens directly into the full-bleed Escazú map — no chrome.
  const [segments, stats] = await Promise.all([getSegments(), getStats()]);

  return (
    <>
      {stats.dataRead?.degraded ? <DataDegradedBanner /> : null}
      {/* The honesty strip labels demo data; with demo off there is nothing to
          label (the network is neutral + real CV), so it disappears. */}
      {showDemoData() && !stats.dataRead?.degraded ? <DemoBanner /> : null}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AuditMap segments={segments} stats={stats} />
      </main>
    </>
  );
}
