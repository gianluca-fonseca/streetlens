/**
 * site.ts — the one place the public origin of this deployment is decided, and
 * the one builder every `[locale]` route uses to declare its metadata.
 *
 * WHY ONE FILE. Canonical URLs, hreflang alternates, `og:url` and the OG image
 * base all need the same absolute origin. Repeating a literal across nine pages
 * is how a staging host ends up in a production canonical tag, so the origin is
 * resolved here and nowhere else, exactly like `demo-flag.ts` owns the demo
 * switch.
 *
 * ORIGIN RESOLUTION, in order:
 *   1. `NEXT_PUBLIC_SITE_URL` — an explicit override. A fork, a self-host, or a
 *      staging box that owns its own domain sets this and it wins over
 *      everything below.
 *   2. A Vercel deployment that is NOT production (`VERCEL_ENV` is "preview" or
 *      "development") resolves to its OWN host via `VERCEL_URL`. A preview that
 *      declared the production canonical would be asking a crawler to index
 *      streetlens.org from a build nobody shipped.
 *   3. `VERCEL_PROJECT_PRODUCTION_URL` / `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`
 *      — injected by Vercel and pointing at the project's production domain,
 *      which is `streetlens.org` once the domain is attached to the project.
 *   4. `PRODUCTION_ORIGIN` — the literal below. Reached by any production build
 *      (`next build` / `next start`) with no Vercel environment around it, which
 *      is what bakes the right canonical into the prerendered pages and the
 *      static OG cards.
 *   5. `http://localhost:3000` — `next dev` only.
 *
 * WHY THE LITERAL IS HERE AND NOWHERE ELSE. Steps 1-3 are configuration, so a
 * preview resolves to itself and a fork resolves to its own domain. But a
 * canonical origin that exists ONLY as a dashboard setting is one unset variable
 * away from a production build publishing `http://localhost:3000` in every
 * `og:image`, and nothing on screen would change. The default belongs in the one
 * file that already owns the origin; the metadata test locks it.
 *
 * Read at call time rather than frozen into a module constant, so a test can
 * exercise several origins in one process.
 */

import type { Metadata, MetadataRoute } from "next";
import type { Locale } from "@/i18n/routing";

/** Brand name used in `og:site_name` and the document title template. */
export const SITE_NAME = "StreetLens";

/**
 * Title template applied by the root layout to every child route's title.
 * Kept in code rather than in `messages/*.json` because it carries no
 * translatable words: a translator editing it could only break the brand or
 * drop the `%s`. Pages that already name the brand bypass it via
 * `title.absolute`.
 */
export const TITLE_SEPARATOR = " · ";
export const TITLE_TEMPLATE = `%s${TITLE_SEPARATOR}${SITE_NAME}`;

/**
 * The self-contained form of a page title, for social cards. A tab title can
 * afford to be one word because the tab sits inside a browser; a shared link
 * cannot, so the brand is spelled out unless the title already does it.
 */
export function socialTitleFor(title: string, absoluteTitle = false): string {
  return absoluteTitle ? title : `${title}${TITLE_SEPARATOR}${SITE_NAME}`;
}

/** Locales this site publishes, canonical one first. Mirrors `i18n/routing`. */
export const SITE_LOCALES = ["en", "es"] as const;

/** The locale search engines get for `x-default`. */
export const DEFAULT_SITE_LOCALE: Locale = "en";

/**
 * OpenGraph locale codes. Spanish is Costa Rican here (the pilot is Escazú),
 * matching the es-CR conventions the routing config already documents.
 */
export const OG_LOCALE: Readonly<Record<Locale, string>> = {
  en: "en_US",
  es: "es_CR",
};

/**
 * The canonical public origin of StreetLens. The production domain, and the
 * default any production build falls back to. See the resolution order at the
 * top of this file for when it is and is not reached.
 */
export const PRODUCTION_ORIGIN = "https://streetlens.org";

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/** `host` or `https://host/` in, `https://host` out. Empty string if neither. */
function asOrigin(value: string | undefined): string {
  const bare = stripTrailingSlashes((value ?? "").trim().replace(/^https?:\/\//, ""));
  return bare ? `https://${bare}` : "";
}

/** The public origin of this deployment, without a trailing slash. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return stripTrailingSlashes(explicit);

  // A preview or a Vercel dev deployment answers for itself. `VERCEL_URL` is the
  // per-deployment host, so each preview gets its own canonical and none of them
  // claims to be the production site.
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    const self = asOrigin(process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL);
    if (self) return self;
  }

  const productionHost = asOrigin(
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  if (productionHost) return productionHost;

  if (process.env.NODE_ENV === "production") return PRODUCTION_ORIGIN;

  return "http://localhost:3000";
}

/** `metadataBase` for the root layout, so relative metadata URLs resolve. */
export function siteMetadataBase(): URL {
  return new URL(siteUrl());
}

/**
 * Locale-prefixed path for a route. `path` is the route WITHOUT its locale
 * segment ("/" for the landing page, "/map" for the map).
 * The app uses `localePrefix: "always"`, so `/` becomes `/en`, never `/`.
 */
export function localePath(locale: Locale | string, path: string): string {
  const clean = path === "/" ? "" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return `/${locale}${clean}`;
}

/** Absolute URL for a locale-prefixed route. */
export function absoluteUrl(locale: Locale | string, path: string): string {
  return `${siteUrl()}${localePath(locale, path)}`;
}

/**
 * Canonical + hreflang set for one route. Values stay relative on purpose;
 * `metadataBase` turns them absolute, so there is still exactly one origin.
 * `x-default` points at the canonical locale, which is what a crawler should
 * serve to a visitor whose language we do not publish.
 */
export function routeAlternates(locale: Locale, path: string): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const l of SITE_LOCALES) languages[l] = localePath(l, path);
  languages["x-default"] = localePath(DEFAULT_SITE_LOCALE, path);

  return { canonical: localePath(locale, path), languages };
}

/**
 * Every public, indexable route, locale prefix excluded. The sitemap is built
 * from this list and the metadata test asserts each entry against the page that
 * serves it, so a new route cannot be added without both noticing.
 *
 * Street report cards (`/street/[segmentId]`) are deliberately ABSENT. They are
 * generated per segment from a dataset that is currently simulated, and
 * submitting several hundred simulated report cards for indexing would put
 * numbers in search results that no one has measured yet. They stay shareable
 * by link; they are not advertised to crawlers until the field data is real.
 */
export const PUBLIC_ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/map", changeFrequency: "daily", priority: 0.9 },
  { path: "/insights", changeFrequency: "daily", priority: 0.8 },
  { path: "/method", changeFrequency: "monthly", priority: 0.7 },
  { path: "/rubric", changeFrequency: "monthly", priority: 0.7 },
  { path: "/data", changeFrequency: "weekly", priority: 0.7 },
  { path: "/brief", changeFrequency: "weekly", priority: 0.6 },
  { path: "/press", changeFrequency: "monthly", priority: 0.6 },
  { path: "/collect", changeFrequency: "monthly", priority: 0.6 },
] as const satisfies ReadonlyArray<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}>;

/**
 * Route prefixes no crawler should follow: the password-gated admin surface and
 * the per-walk status pages, whose URLs carry a session id. Both also declare
 * `noindex` in their own segments; robots.txt keeps the crawl from happening at
 * all, the meta tag covers a URL that leaks some other way.
 */
export function disallowedCrawlPaths(): string[] {
  return SITE_LOCALES.flatMap((locale) => [
    `/${locale}/admin/`,
    `/${locale}/collect/status/`,
  ]).concat("/api/");
}

export type PageMetadataInput = Readonly<{
  locale: Locale;
  /** Route path WITHOUT the locale prefix: "/" for the landing, "/map", … */
  path: string;
  title: string;
  description: string;
  /** Social-card headline, when the browser-tab title is too terse to share. */
  ogTitle?: string;
  ogDescription?: string;
  /**
   * Set when `title` is already a whole title and must not pick up the layout's
   * "%s · StreetLens" template (the landing page, which names the brand itself).
   */
  absoluteTitle?: boolean;
  ogType?: "website" | "article";
}>;

/**
 * The metadata every `[locale]` page returns. Guarantees, per route: a
 * canonical URL, both hreflang alternates plus x-default, a fully specified
 * OpenGraph card with `og:url`/`og:locale`/`og:locale:alternate`, and a
 * large-image Twitter card.
 *
 * `og:image` is deliberately NOT set here. Each route ships an
 * `opengraph-image.tsx` file, and the file convention emits the image URL with
 * its width, height, type and alt text for us. Setting `openGraph.images` in
 * code as well would mean two sources of truth for the same tag.
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const { locale, path, title, description } = input;
  const alternateLocales = SITE_LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]);
  const socialTitle = input.ogTitle ?? socialTitleFor(title, input.absoluteTitle);
  const socialDescription = input.ogDescription ?? description;

  return {
    title: input.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: routeAlternates(locale, path),
    openGraph: {
      type: input.ogType ?? "website",
      url: localePath(locale, path),
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      alternateLocale: alternateLocales,
      title: { absolute: socialTitle },
      description: socialDescription,
    },
    twitter: {
      card: "summary_large_image",
      title: { absolute: socialTitle },
      description: socialDescription,
    },
  };
}
