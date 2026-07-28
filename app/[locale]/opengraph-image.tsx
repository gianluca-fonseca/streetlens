/**
 * Site-default social card. Serves the landing page, and any route below
 * `[locale]` that does not ship its own `opengraph-image`.
 */
import type { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { brandOgContentType, brandOgSize, renderBrandOgImage } from "@/lib/og-brand";

export const runtime = "nodejs";
export const alt =
  "StreetLens: an open-source field instrument that scores sidewalk accessibility, drainage, shade, and bike infrastructure segment by segment.";
export const size = brandOgSize;
export const contentType = brandOgContentType;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return renderBrandOgImage({
    locale,
    title: t("ogTitle"),
    subtitle: t("ogDescription"),
  });
}
