import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import Hero from "@/components/landing/Hero";
import GapSection from "@/components/landing/GapSection";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      type: "website",
    },
  };
}

export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The Civic Atlas landing: the live map is the hero; honest numbers carry it.
  const [segments, stats] = await Promise.all([getSegments(), getStats()]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
      <Hero segments={segments} stats={stats} />
      <GapSection heroPct={stats.heroPct} />
    </main>
  );
}
