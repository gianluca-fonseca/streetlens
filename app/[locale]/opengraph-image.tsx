/**
 * Site-default social card. Serves the landing page, and any route below
 * `[locale]` that does not ship its own `opengraph-image`. The landing card
 * uses the punchier `ogTitle`/`ogDescription` pair rather than the tab title.
 */
import type { Locale } from "@/i18n/routing";
import {
  brandOgImageMetadata,
  brandOgStrings,
  renderBrandOgImage,
  resolveOgLocale,
} from "@/lib/og-brand";

export const runtime = "nodejs";

const NAMESPACE = "landing.meta";

type OgProps = Readonly<{ params: Promise<{ locale: Locale }> }>;

export async function generateImageMetadata({ params }: OgProps) {
  const locale = resolveOgLocale(await params);
  const strings = await brandOgStrings(locale, NAMESPACE);
  return [brandOgImageMetadata(strings.ogAlt)];
}

export default async function Image({ params }: OgProps) {
  const locale = resolveOgLocale(await params);
  const strings = await brandOgStrings(locale, NAMESPACE);
  return renderBrandOgImage({
    locale,
    title: strings.ogTitle,
    subtitle: strings.ogDescription,
  });
}
