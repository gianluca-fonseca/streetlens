/**
 * Social card for the data route. Shape and styling come from the shared
 * brand card so every StreetLens link previews as one system.
 */
import type { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { MUNICIPALITY } from "@/lib/municipality";
import { brandOgContentType, brandOgSize, renderBrandOgImage } from "@/lib/og-brand";

export const runtime = "nodejs";
export const alt =
  "StreetLens open data: scrubbed GeoJSON and CSV of the published observed street network, with licence and field dictionary.";
export const size = brandOgSize;
export const contentType = brandOgContentType;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "data.meta" });
  return renderBrandOgImage({
    locale,
    title: t("title", { municipality: MUNICIPALITY.name }),
    subtitle: t("description", { municipality: MUNICIPALITY.name }),
  });
}
