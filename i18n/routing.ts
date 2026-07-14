import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  /** English is the canonical locale; Spanish (es-CR conventions) is the second. */
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
