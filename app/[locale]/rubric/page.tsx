import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import RubricView from "@/components/rubric/RubricView";
import { buildPageMetadata } from "@/lib/site";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "rubricPage.meta" });
  return buildPageMetadata({
    locale,
    path: "/rubric",
    title: t("title"),
    description: t("description"),
  });
}

export default async function RubricPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RubricView locale={locale} />;
}
