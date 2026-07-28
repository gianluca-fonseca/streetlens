/**
 * Social card for the map route. Shape and styling come from the shared
 * brand card so every StreetLens link previews as one system.
 */
import type { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { MUNICIPALITY } from "@/lib/municipality";
import { brandOgContentType, brandOgSize, renderBrandOgImage } from "@/lib/og-brand";

export const runtime = "nodejs";
export const alt =
  "The StreetLens street map: every segment of the pilot network, coloured by its accessibility, drainage, shade, and bike-infrastructure score.";
export const size = brandOgSize;
export const contentType = brandOgContentType;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "map.meta" });
  return renderBrandOgImage({
    locale,
    title: t("title", { municipality: MUNICIPALITY.name }),
    subtitle: t("description", { municipality: MUNICIPALITY.name }),
  });
}
