/**
 * robots.txt — everything public is crawlable; the two surfaces that are not
 * public are named explicitly rather than left to a meta tag alone.
 *
 * The host and the sitemap URL both come from `lib/site.ts`, so a deployment
 * cannot end up advertising one origin here and another in its canonical tags.
 */
import type { MetadataRoute } from "next";
import { disallowedCrawlPaths, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: disallowedCrawlPaths(),
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
