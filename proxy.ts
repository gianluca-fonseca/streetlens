import createIntlProxy from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE, verifySessionToken } from "./lib/admin-auth";

/**
 * Composed proxy (Next.js 16 renamed `middleware` -> `proxy`; only one file is
 * supported per project). Two responsibilities, in order:
 *
 *  1. Admin guard — `/[locale]/admin/**` (except the login page) requires a
 *     valid signed session cookie, else redirect to the localized login page.
 *     This is an OPTIMISTIC check; each `/api/admin/*` route handler re-verifies
 *     the session independently (the proxy matcher excludes `/api`).
 *  2. Locale routing — next-intl handles prefixing + Accept-Language detection.
 */

const intlProxy = createIntlProxy(routing);

const ADMIN_RE = /^\/(en|es)\/admin(?:\/(.*))?$/;

function isLoginPath(rest: string | undefined): boolean {
  if (!rest) return false;
  const seg = rest.replace(/\/+$/, "");
  return seg === "login";
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = ADMIN_RE.exec(pathname);

  if (match && !isLoginPath(match[2])) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const valid = await verifySessionToken(token);
    if (!valid) {
      const locale = match[1];
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/admin/login`;
      url.search = "";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  return intlProxy(request);
}

export const config = {
  // Match all pathnames except API routes, Next.js internals, and static files.
  matcher: ["/((?!api|trpc|_next|_vercel|.*\\..*).*)"],
};
