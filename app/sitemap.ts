/**
 * sitemap.xml — one entry per public route, with both locales declared as
 * alternates of each other.
 *
 * The `loc` is the English URL and the Spanish one rides along in
 * `xhtml:link rel="alternate"`, which is what Google's localized-sitemap format
 * asks for: one `<url>` per piece of content, not one per translation.
 *
 * The route list lives in `lib/site.ts` next to the metadata builder, so the
 * sitemap and the pages cannot drift apart.
 */
import type { MetadataRoute } from "next";
import {
  DEFAULT_SITE_LOCALE,
  PUBLIC_ROUTES,
  SITE_LOCALES,
  absoluteUrl,
} from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Static route set, so build time is the honest answer for "last modified".
  const lastModified = new Date();

  return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => {
    const languages: Record<string, string> = {};
    for (const locale of SITE_LOCALES) languages[locale] = absoluteUrl(locale, path);
    languages["x-default"] = absoluteUrl(DEFAULT_SITE_LOCALE, path);

    return {
      url: absoluteUrl(DEFAULT_SITE_LOCALE, path),
      lastModified,
      changeFrequency,
      priority,
      alternates: { languages },
    };
  });
}
