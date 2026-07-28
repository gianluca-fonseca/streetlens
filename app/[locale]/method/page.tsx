import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import MethodView from "@/components/method/MethodView";
import { buildPageMetadata } from "@/lib/site";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodPage.meta" });
  return buildPageMetadata({
    locale,
    path: "/method",
    title: t("title"),
    description: t("description"),
  });
}

export default async function MethodPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MethodView locale={locale} />;
}
