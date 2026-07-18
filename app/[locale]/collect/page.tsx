import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import CollectClient from "@/app/[locale]/collect/CollectClient";
import { parseCollectDeepLink } from "@/lib/capture/collect-deep-link";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "collect.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function CollectPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const deepLink = parseCollectDeepLink(query);

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <CollectClient locale={locale} deepLink={deepLink} />
    </main>
  );
}
