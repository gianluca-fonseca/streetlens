/**
 * Social card for the press route. Shape and styling come from the shared
 * brand card so every StreetLens link previews as one system.
 */
import type { Locale } from "@/i18n/routing";
import {
  brandOgImageMetadata,
  brandOgStrings,
  renderBrandOgImage,
  resolveOgLocale,
} from "@/lib/og-brand";

export const runtime = "nodejs";

const NAMESPACE = "press.meta";

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
    title: strings.title,
    subtitle: strings.description,
  });
}
