/**
 * Social card for the collect route. Shape and styling come from the shared
 * brand card so every StreetLens link previews as one system.
 */
import type { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { brandOgContentType, brandOgSize, renderBrandOgImage } from "@/lib/og-brand";

export const runtime = "nodejs";
export const alt =
  "Record a walk with StreetLens: your phone stamps every frame with GPS and matches it to a street segment.";
export const size = brandOgSize;
export const contentType = brandOgContentType;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "collect.meta" });
  return renderBrandOgImage({
    locale,
    title: t("title"),
    subtitle: t("description"),
  });
}
