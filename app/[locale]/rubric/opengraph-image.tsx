/**
 * Social card for the rubric route. Shape and styling come from the shared
 * brand card so every StreetLens link previews as one system.
 */
import type { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { brandOgContentType, brandOgSize, renderBrandOgImage } from "@/lib/og-brand";

export const runtime = "nodejs";
export const alt =
  "StreetLens rubric v0.1: the 15 observed items, by lens, with the Ley 7600 accessibility threshold.";
export const size = brandOgSize;
export const contentType = brandOgContentType;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "rubricPage.meta" });
  return renderBrandOgImage({
    locale,
    title: t("title"),
    subtitle: t("description"),
  });
}
