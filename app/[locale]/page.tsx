import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import Hero from "@/components/landing/Hero";
import MissionSection from "@/components/landing/MissionSection";
import MeasureSection from "@/components/landing/MeasureSection";
import GapSection from "@/components/landing/GapSection";
import PilotSection from "@/components/landing/PilotSection";
import MethodSection from "@/components/landing/MethodSection";
import GroundingSection from "@/components/landing/GroundingSection";
import RoadmapSection from "@/components/landing/RoadmapSection";
import FaqSection from "@/components/landing/FaqSection";
import CtaSection from "@/components/landing/CtaSection";
import Footer from "@/components/landing/Footer";

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

  // The StreetLens landing: the platform first, the Escazú pilot as the proof.
  // The hero holds the one live map; every other section uses rendered imagery.
  const [segments, stats] = await Promise.all([getSegments(), getStats()]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
      <Hero segments={segments} stats={stats} />
      <MissionSection />
      <MeasureSection />
      <GapSection heroPct={stats.heroPct} />
      <PilotSection stats={stats} />
      <MethodSection />
      <GroundingSection />
      <RoadmapSection />
      <FaqSection />
      <CtaSection />
      <Footer />
    </main>
  );
}
