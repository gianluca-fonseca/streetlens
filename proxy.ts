import createIntlProxy from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Locale-prefix routing with Accept-Language detection (Next.js 16 proxy,
 * formerly middleware). Visitors whose browser prefers Spanish (e.g. most
 * visitors from Costa Rica) land on /es; everyone else defaults to /en.
 */
export default createIntlProxy(routing);

export const config = {
  // Match all pathnames except API routes, Next.js internals, and static files.
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
