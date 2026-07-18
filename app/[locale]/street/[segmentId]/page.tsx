import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import StreetCard from "@/components/street/StreetCard";
import StreetChrome from "@/components/street/StreetChrome";
import { getStreetCard } from "@/lib/street-card";

export const revalidate = 300;

type PageProps = Readonly<{
  params: Promise<{ locale: Locale; segmentId: string }>;
}>;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, segmentId } = await params;
  const card = await getStreetCard(segmentId, locale);
  if (!card) {
    const t = await getTranslations({ locale, namespace: "street.meta" });
    return { title: t("notFoundTitle") };
  }

  const t = await getTranslations({ locale, namespace: "street.meta" });
  const title = t("title", { name: card.name, district: card.district });
  const description = t("description", {
    name: card.name,
    district: card.district,
    score: card.scores.overall,
  });

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function StreetPage({ params }: PageProps) {
  const { locale, segmentId } = await params;
  setRequestLocale(locale);

  const card = await getStreetCard(segmentId, locale);
  if (!card) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <StreetChrome />
      <StreetCard card={card} />
    </main>
  );
}
