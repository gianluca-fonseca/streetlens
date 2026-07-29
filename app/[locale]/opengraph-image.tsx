/**
 * Site-default social card. Serves the landing page, and any route below
 * `[locale]` that does not ship its own `opengraph-image`.
 *
 * This is the one card most people ever see, so it is the one that carries the
 * instrument: the extruded score relief behind a scrim, the punchier `ogTitle`
 * over it, one supporting line, and the demo caveat. `renderReliefOgImage` reads
 * the committed render off disk at build time; this route prerenders, so nothing
 * here runs on a request.
 */
import type { Locale } from "@/i18n/routing";
import {
  brandOgImageMetadata,
  brandOgStrings,
  renderReliefOgImage,
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
  return renderReliefOgImage({
    locale,
    title: strings.ogTitle,
    line: strings.ogCardLine,
    caveat: strings.ogCardCaveat,
  });
}
