#!/usr/bin/env node
/**
 * test-site-metadata.mjs
 *
 * The metadata contract for the public site. Every assertion here exists
 * because the failure it catches is invisible: nothing on screen changes when a
 * canonical tag points at the wrong host, when a new page inherits the site
 * title instead of naming itself, or when a Spanish page tells a crawler it has
 * no Spanish version. You find out from a stakeholder's link preview.
 *
 * What is locked:
 *
 *  1. ONE ORIGIN. `lib/site.ts` is the only place a base URL is decided, and
 *     the layout feeds it to `metadataBase`. No page file may contain a
 *     hardcoded https:// literal for this site.
 *  2. EVERY ROUTE DECLARES ITSELF. Each public route ships generateMetadata,
 *     routes it through the shared builder, and passes the path it actually
 *     serves. A route that says "/press" while living at app/[locale]/brief
 *     would emit a canonical URL for a different page.
 *  3. BOTH LOCALES, EVERY ROUTE. en, es and x-default alternates, plus og:locale
 *     and og:locale:alternate that are actually different from each other.
 *  4. TITLES AND DESCRIPTIONS ARE REAL AND DISTINCT. Non-empty in both locales,
 *     and no two routes share a title or a description. Two pages with the same
 *     description is the signature of a scaffold.
 *  5. BILINGUAL. Every metadata key a route reads exists in BOTH messages files.
 *  6. HONESTY. Metadata copy may not claim completed field audits. The pilot
 *     dataset is simulated and this copy is what an external stakeholder reads
 *     first.
 *  7. ROBOTS, SITEMAP, ICONS. Present, covering exactly the public routes, with
 *     the non-public surfaces disallowed.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app", "[locale]");

const site = await import(path.join(ROOT, "lib", "site.ts"));
const { PUBLIC_ROUTES, SITE_LOCALES, buildPageMetadata, siteUrl, disallowedCrawlPaths } = site;

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(p, "utf8");
const messages = Object.fromEntries(
  SITE_LOCALES.map((l) => [l, JSON.parse(read(path.join(ROOT, "messages", `${l}.json`)))]),
);

function leaf(obj, dotted) {
  return dotted.split(".").reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

/**
 * The routes under test, each tied to the directory that serves it and the
 * message namespace it reads. Written out by hand rather than derived, so that
 * a page quietly repointed at another namespace shows up as a diff here.
 */
const ROUTES = [
  { path: "/", dir: "", namespace: "landing.meta" },
  { path: "/map", dir: "map", namespace: "map.meta" },
  { path: "/insights", dir: "insights", namespace: "insights.meta" },
  { path: "/method", dir: "method", namespace: "methodPage.meta" },
  { path: "/rubric", dir: "rubric", namespace: "rubricPage.meta" },
  { path: "/data", dir: "data", namespace: "data.meta" },
  { path: "/brief", dir: "brief", namespace: "brief.meta" },
  { path: "/press", dir: "press", namespace: "press.meta" },
  { path: "/collect", dir: "collect", namespace: "collect.meta" },
];

console.log("\n1. One origin, configured once\n");

check(
  "siteUrl() is an absolute http(s) URL",
  /^https?:\/\/[^/]+$/.test(siteUrl()),
  siteUrl(),
);
check("siteUrl() carries no trailing slash", !siteUrl().endsWith("/"));
{
  const layout = read(path.join(APP, "layout.tsx"));
  check("locale layout sets metadataBase", /metadataBase:\s*siteMetadataBase\(\)/.test(layout));
  check("locale layout sets a title template", /template:\s*TITLE_TEMPLATE/.test(layout));
}
{
  // A hardcoded origin in a page is exactly how a staging host reaches a
  // production canonical tag. External links (github, linkedin) live in
  // lib/links.ts and are not page-level, so any https:// here is suspect.
  const offenders = ROUTES.filter((r) =>
    /https:\/\//.test(read(path.join(APP, r.dir, "page.tsx"))),
  ).map((r) => r.path);
  check("no page hardcodes an absolute URL", offenders.length === 0, JSON.stringify(offenders));
}

console.log("\n2. Every public route declares its own metadata\n");

for (const route of ROUTES) {
  const src = read(path.join(APP, route.dir, "page.tsx"));
  const label = route.path;
  check(`${label} exports generateMetadata`, /export async function generateMetadata/.test(src));
  check(`${label} uses the shared builder`, /buildPageMetadata\(\{/.test(src));
  check(
    `${label} declares its own path`,
    new RegExp(`path:\\s*"${route.path.replace("/", "\\/")}"`).test(src),
  );
  check(`${label} reads namespace ${route.namespace}`, src.includes(`"${route.namespace}"`));
  check(`${label} ships an opengraph-image`, existsSync(path.join(APP, route.dir, "opengraph-image.tsx")));
}

console.log("\n3. Canonical, hreflang and OpenGraph, per route per locale\n");

for (const route of ROUTES) {
  for (const locale of SITE_LOCALES) {
    const meta = buildPageMetadata({
      locale,
      path: route.path,
      title: "T",
      description: "D",
    });
    const langs = meta.alternates.languages;
    const expected = route.path === "/" ? "" : route.path;
    const tag = `${locale}${route.path}`;

    check(`${tag} canonical is locale-prefixed`, meta.alternates.canonical === `/${locale}${expected}`);
    check(
      `${tag} declares every locale alternate`,
      SITE_LOCALES.every((l) => langs[l] === `/${l}${expected}`),
      JSON.stringify(langs),
    );
    check(`${tag} declares x-default`, langs["x-default"] === `/en${expected}`);
    check(`${tag} og:url matches canonical`, meta.openGraph.url === meta.alternates.canonical);
    check(
      `${tag} og:locale differs from og:locale:alternate`,
      meta.openGraph.locale &&
        meta.openGraph.alternateLocale.length === SITE_LOCALES.length - 1 &&
        !meta.openGraph.alternateLocale.includes(meta.openGraph.locale),
      `${meta.openGraph.locale} vs ${JSON.stringify(meta.openGraph.alternateLocale)}`,
    );
    check(`${tag} twitter card is summary_large_image`, meta.twitter.card === "summary_large_image");
    check(
      `${tag} social title names the brand`,
      meta.openGraph.title.absolute.includes("StreetLens"),
      meta.openGraph.title.absolute,
    );
  }
}

console.log("\n4. Titles and descriptions: present, bilingual, distinct\n");

const seen = { title: new Map(), description: new Map() };
for (const route of ROUTES) {
  for (const locale of SITE_LOCALES) {
    const node = leaf(messages[locale], route.namespace);
    check(`${locale} has ${route.namespace}`, node != null && typeof node === "object");
    if (node == null) continue;

    for (const key of ["title", "description", "ogAlt"]) {
      const value = node[key];
      check(
        `${locale} ${route.namespace}.${key} is a non-empty string`,
        typeof value === "string" && value.trim().length > 0,
      );
    }
    // The layout supplies " · StreetLens"; a page repeating it would double it.
    check(
      `${locale} ${route.namespace}.title does not re-suffix the brand`,
      !/\|\s*StreetLens\s*$/.test(node.title ?? ""),
      node.title,
    );

    for (const key of ["title", "description"]) {
      const value = node[key];
      const bucket = seen[key];
      const at = `${locale}${route.path}`;
      check(
        `${at} ${key} is unique across routes`,
        !bucket.has(value),
        bucket.has(value) ? `duplicates ${bucket.get(value)}` : "",
      );
      bucket.set(value, at);
    }
  }
}

// The landing page owns a whole title, so it must opt out of the template.
{
  const landing = read(path.join(APP, "page.tsx"));
  check("landing opts out of the title template", /absoluteTitle:\s*true/.test(landing));
  for (const locale of SITE_LOCALES) {
    const node = leaf(messages[locale], "landing.meta");
    check(`${locale} landing title names the brand itself`, /StreetLens/.test(node.title ?? ""));
    for (const key of ["ogTitle", "ogDescription"]) {
      check(
        `${locale} landing.meta.${key} is a non-empty string`,
        typeof node[key] === "string" && node[key].trim().length > 0,
      );
    }
  }
}

console.log("\n5. Honesty: no claimed field audits in metadata copy\n");

// Phrases that would present the SIMULATED pilot dataset as finished fieldwork.
const DISHONEST = [
  /\bwe (?:have )?audited\b/i,
  /\baudit(?:ed|s) complete\b/i,
  /\b\d[\d,.]*\s+(?:streets?|segments?|calles|segmentos)\s+(?:audited|auditad[oa]s|surveyed)\b/i,
  /\bfield ?work (?:is )?(?:complete|done|finished)\b/i,
  /\btrabajo de campo (?:completado|finalizado|terminado)\b/i,
];
for (const route of ROUTES) {
  for (const locale of SITE_LOCALES) {
    const node = leaf(messages[locale], route.namespace) ?? {};
    const copy = Object.values(node).filter((v) => typeof v === "string").join(" ");
    const hit = DISHONEST.find((re) => re.test(copy));
    check(`${locale}${route.path} metadata copy claims no completed audit`, !hit, hit ? String(hit) : "");
  }
}

console.log("\n6. robots, sitemap and the icon set\n");

{
  const routePaths = PUBLIC_ROUTES.map((r) => r.path).sort();
  check(
    "PUBLIC_ROUTES covers exactly the routes under test",
    JSON.stringify(routePaths) === JSON.stringify(ROUTES.map((r) => r.path).sort()),
    JSON.stringify(routePaths),
  );
  check(
    "every PUBLIC_ROUTES entry has a changeFrequency and priority",
    PUBLIC_ROUTES.every((r) => typeof r.changeFrequency === "string" && typeof r.priority === "number"),
  );
  check("app/sitemap.ts exists", existsSync(path.join(ROOT, "app", "sitemap.ts")));
  check("app/robots.ts exists", existsSync(path.join(ROOT, "app", "robots.ts")));

  const sitemap = read(path.join(ROOT, "app", "sitemap.ts"));
  check("sitemap is built from PUBLIC_ROUTES", /PUBLIC_ROUTES\.map/.test(sitemap));
  check("sitemap emits locale alternates", /alternates:\s*\{\s*languages/.test(sitemap));

  const disallowed = disallowedCrawlPaths();
  for (const locale of SITE_LOCALES) {
    check(`robots disallows /${locale}/admin/`, disallowed.includes(`/${locale}/admin/`));
    check(
      `robots disallows /${locale}/collect/status/`,
      disallowed.includes(`/${locale}/collect/status/`),
    );
  }
  check("robots disallows /api/", disallowed.includes("/api/"));
  check(
    "no public route is disallowed",
    !PUBLIC_ROUTES.some(({ path: p }) =>
      disallowed.some((d) => SITE_LOCALES.some((l) => `/${l}${p === "/" ? "" : p}`.startsWith(d))),
    ),
  );

  // Both non-public surfaces also say noindex in their own segment, so a leaked
  // URL is covered even where robots.txt is not consulted.
  check(
    "admin segment declares noindex",
    /robots:\s*\{\s*index:\s*false/.test(read(path.join(APP, "admin", "layout.tsx"))),
  );
  check(
    "walk status page declares noindex",
    /robots:\s*\{\s*index:\s*false/.test(
      read(path.join(APP, "collect", "status", "[id]", "page.tsx")),
    ),
  );
}

for (const icon of ["favicon.ico", "icon.svg", "apple-icon.tsx"]) {
  check(`app/${icon} exists`, existsSync(path.join(ROOT, "app", icon)));
}

console.log("\n=== summary ===");
console.log(`${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length} failing assertion(s)`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
