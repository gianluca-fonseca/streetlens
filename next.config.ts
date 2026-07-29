import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /**
   * The landing social card composes over `public/hero-relief.jpg`, read off
   * disk by `lib/og-brand.tsx`. That read happens at BUILD time (every
   * `opengraph-image` route on this site prerenders), so this include is not on
   * the hot path. It is here for the one path that would reach the file at
   * request time, a re-render of the card outside the prerender: files under
   * `public/` are served by the CDN and are not otherwise traced into the
   * serverless bundle, and a missing background would fail the route rather than
   * quietly degrade it.
   */
  outputFileTracingIncludes: {
    "/[locale]/opengraph-image": ["./public/hero-relief.jpg"],
  },
};

export default withNextIntl(nextConfig);
