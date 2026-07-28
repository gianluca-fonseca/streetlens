import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import StreetCard from "@/components/street/StreetCard";
import StreetChrome from "@/components/street/StreetChrome";
import { demoDataEnabled } from "@/lib/demo-flag-server";
import { buildPageMetadata } from "@/lib/site";
import { getStreetCard } from "@/lib/street-card";

export const revalidate = 300;

type PageProps = Readonly<{
  params: Promise<{ locale: Locale; segmentId: string }>;
}>;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, segmentId } = await params;
  const card = await getStreetCard(segmentId, locale, await demoDataEnabled());
  if (!card) {
    const t = await getTranslations({ locale, namespace: "street.meta" });
    return { title: t("notFoundTitle") };
  }

  const t = await getTranslations({ locale, namespace: "street.meta" });
  const title = t("title", { name: card.name, district: card.district });
  // An unaudited street has no score to quote. Printing "Overall score 0/100"
  // into a share preview would publish an orphaned zero somewhere no reader can
  // see the caveat, so the description says what is true instead.
  const description = card.hasAudit
    ? t("description", {
        name: card.name,
        district: card.district,
        score: card.scores.overall,
      })
    : t("descriptionUnaudited", { name: card.name, district: card.district });

  return buildPageMetadata({
    locale,
    path: `/street/${segmentId}`,
    title,
    description,
    ogType: "article",
  });
}

export default async function StreetPage({ params }: PageProps) {
  const { locale, segmentId } = await params;
  setRequestLocale(locale);

  const card = await getStreetCard(segmentId, locale, await demoDataEnabled());
  if (!card) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <StreetChrome />
      <StreetCard card={card} />
    </main>
  );
}
