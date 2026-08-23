import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegments, getStats } from "@/lib/segments";
import { getSchoolReports, summarizeSchools } from "@/lib/school-report";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import { buildPageMetadata } from "@/lib/site";
import Hero from "@/components/landing/Hero";
import SchoolSafetySection from "@/components/landing/SchoolSafetySection";
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
import DataDegradedBanner from "@/components/DataDegradedBanner";

// ISR, same reason as the map: the landing's pilot stats include CV sessions/segments
// reviewed (getStats), which move when an admin approves a session after deploy.
// Revalidate every 5 minutes so those counts refresh without a redeploy.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return buildPageMetadata({
    locale,
    path: "/",
    // The landing title already carries the brand, so it opts out of the
    // layout's "%s · StreetLens" template rather than saying it twice.
    absoluteTitle: true,
    title: t("title"),
    description: t("description"),
    ogTitle: t("ogTitle"),
    ogDescription: t("ogDescription"),
  });
}

export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The StreetLens landing: school safety first, the instrument as the proof.
  // The hero holds the one live map; every other section uses rendered imagery.
  const demoEnabled = await demoDataEnabled();
  const [segments, stats, reports] = await Promise.all([
    getSegments(demoEnabled),
    getStats(demoEnabled),
    getSchoolReports(demoEnabled),
  ]);
  const schoolSummary = summarizeSchools(reports);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
      {stats.dataRead?.degraded ? <DataDegradedBanner /> : null}
      <Hero segments={segments} stats={stats} />
      {/* Raised stacking context: the hero plate parallax-drifts beneath this
          document (see .sl-parallax-plate in globals.css), so everything after
          the hero must paint above it. */}
      <div className="relative z-[1]">
        {/* The use case before the instrument: a street-quality score is a
            capability, and a capability does not tell anyone why to care. */}
        <SchoolSafetySection locale={locale} summary={schoolSummary} />
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
      </div>
    </main>
  );
}
