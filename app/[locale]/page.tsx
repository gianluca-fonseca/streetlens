import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import AuditMap from "@/components/AuditMap";
import DemoBanner from "@/components/DemoBanner";

export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The app opens directly into the full-bleed Escazú map — no marketing hero.
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
