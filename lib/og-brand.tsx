/**
 * og-brand.tsx — the shared social card every top-level route renders.
 *
 * `app/[locale]/street/[segmentId]/opengraph-image.tsx` already established the
 * house style for this site's OG images: 1200x630, `next/og`, near-black
 * ground, system-ui, the four lens colours pulled from the map's own ramp, and
 * the wordmark in signal pink. This module is that same card with the
 * street-specific numbers removed, so the other routes extend the convention
 * instead of inventing a second one.
 *
 * Deliberately carries NO scores and NO counts. A social card is the first
 * thing a stakeholder sees, and the pilot dataset is simulated; the card sells
 * the instrument and the method, never a claimed field result.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
// Ground is #0a0a0a: sample the DARK half of the ramp (mapConfig rev 8).
import { sampleRamp } from "@/components/mapConfig";
import type { Locale } from "@/i18n/routing";
import { MUNICIPALITY, getMunicipalityConfig } from "@/lib/municipality";
import { DEFAULT_SITE_LOCALE, SITE_LOCALES, SITE_NAME } from "@/lib/site";

/**
 * Messages are read straight from the locale file rather than through
 * `getTranslations`. next-intl's server API resolves the locale from the
 * request, which calls `headers()`; `generateImageMetadata` runs inside
 * `generateStaticParams` at BUILD time, where there is no request, and Next
 * fails the build for it. The locale is already an explicit argument here, so
 * the request lookup buys nothing. Reading the file directly is what keeps
 * these cards prerenderable, so a crawler is never waiting on image generation.
 */
async function messagesFor(locale: Locale): Promise<Record<string, unknown>> {
  return (await import(`../messages/${locale}.json`)).default;
}

/**
 * Next probes an image route's `generateImageMetadata` once during page-data
 * collection, before the parent `[locale]` params exist, so `params.locale`
 * arrives undefined on that one call. Fall back to the canonical locale rather
 * than trying to import `messages/undefined.json`; the real per-locale calls
 * that follow carry a real locale.
 */
export function resolveOgLocale(params: { locale?: string } | undefined): Locale {
  const candidate = params?.locale;
  return SITE_LOCALES.includes(candidate as Locale)
    ? (candidate as Locale)
    : DEFAULT_SITE_LOCALE;
}

/** The `{municipality}` placeholder is the only one these strings use. */
function interpolate(template: string): string {
  return template.replace(/\{municipality\}/g, MUNICIPALITY.name);
}

function resolve(messages: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      messages,
    );
}

/**
 * Every string in one `*.meta` namespace, interpolated and ready to draw.
 * Routes pull `title`/`description`/`ogAlt` (or the landing's `ogTitle` and
 * `ogDescription`) off the result, so no route file repeats the lookup dance.
 */
export async function brandOgStrings(
  locale: Locale,
  namespace: string,
): Promise<Record<string, string>> {
  const node = resolve(await messagesFor(locale), namespace);
  if (!node || typeof node !== "object") {
    throw new Error(`og-brand: message namespace "${namespace}" not found for locale "${locale}"`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = interpolate(value);
  }
  return out;
}

/** Shared config exports, re-exported by each route's opengraph-image file. */
export const brandOgSize = { width: 1200, height: 630 } as const;
export const brandOgContentType = "image/png";

/**
 * The image-metadata descriptor each route returns from
 * `generateImageMetadata`.
 *
 * A plain `export const alt = "…"` would be simpler, but a static export cannot
 * see the locale, and this site ships every user-facing string in both English
 * and Spanish. `generateImageMetadata` receives the route params, so the alt
 * text can be translated like everything else. One card per route, hence the
 * single fixed id.
 */
export function brandOgImageMetadata(alt: string) {
  return { id: "card", alt, size: brandOgSize, contentType: brandOgContentType };
}

/*
 * ── Type ──────────────────────────────────────────────────────────────────────
 *
 * The site is Space Grotesk (`app/[locale]/layout.tsx`, exposed as
 * `--font-display` / `--font-sans`), so the cards are too. Satori cannot resolve
 * a CSS family name: it has no font fallback chain and no access to the browser's
 * font book, so `fontFamily: "system-ui"` was not a near miss, it was a different
 * typeface on every card this site renders.
 *
 * The bytes are vendored at `assets/fonts/`, two static instances cut from
 * Google Fonts' variable `SpaceGrotesk[wght].ttf` with fontTools at wght 400 and
 * wght 700 (OFL, no reserved font name; the licence ships beside them). Three
 * reasons for vendoring rather than resolving the font at build time:
 *
 *  - `next/font/google` emits a content-hashed `.woff2` under `.next/static/media`.
 *    That path is not stable, and satori does not accept woff2 anyway.
 *  - Fetching from fonts.gstatic.com during `next build` makes every build
 *    depend on a third-party network round trip.
 *  - The variable font's own default instance is wght 300 (Light). Handing satori
 *    the variable file would have produced a *lighter* card than system-ui, since
 *    satori renders the default instance and does not apply the wght axis. The
 *    static instances are the only way to get a real 700.
 *
 * Read once per process and shared by both renderers. `readFile` throwing is the
 * point: a missing font file fails the build loudly rather than letting satori
 * fall back to its bundled Geist and ship the wrong typeface quietly.
 */
export const BRAND_FONT_FAMILY = "Space Grotesk";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

type BrandFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let brandFonts: Promise<BrandFont[]> | null = null;

export function loadBrandFonts(): Promise<BrandFont[]> {
  brandFonts ??= Promise.all([
    readFile(path.join(FONT_DIR, "SpaceGrotesk-Regular.ttf")),
    readFile(path.join(FONT_DIR, "SpaceGrotesk-Bold.ttf")),
  ]).then(([regular, bold]): BrandFont[] => [
    { name: BRAND_FONT_FAMILY, data: regular, weight: 400, style: "normal" },
    { name: BRAND_FONT_FAMILY, data: bold, weight: 700, style: "normal" },
  ]);
  return brandFonts;
}

const LENSES = ["accessibility", "drainage", "shade", "bike"] as const;

/** Long meta descriptions read as copy, not a card. Trim on a word boundary. */
function clamp(text: string, max = 180): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, "")}…`;
}

export type BrandOgInput = Readonly<{
  locale: Locale;
  title: string;
  subtitle: string;
}>;

export async function renderBrandOgImage({
  locale,
  title,
  subtitle,
}: BrandOgInput): Promise<ImageResponse> {
  const lensNames = await Promise.all(
    LENSES.map(async (lens) => (await brandOgStrings(locale, `layers.${lens}`)).name),
  );
  const municipality = getMunicipalityConfig();
  const eyebrow = `${SITE_NAME} · ${municipality.name[locale]}, ${municipality.region[locale]}`;
  const fonts = await loadBrandFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#0a0a0a",
          color: "#f1f1f1",
          fontFamily: BRAND_FONT_FAMILY,
        }}
      >
        {/* Takes the slack so a short title sits optically centred rather than
            stranded above a band of empty ground. */}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#a3a3a3",
              marginBottom: 28,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 66,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              marginBottom: 24,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              lineHeight: 1.35,
              color: "#d4d4d4",
              maxWidth: 940,
            }}
          >
            {clamp(subtitle)}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #262626",
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex" }}>
            {LENSES.map((lens, i) => (
              <div
                key={lens}
                style={{ display: "flex", alignItems: "center", marginRight: 36 }}
              >
                <div
                  style={{
                    display: "flex",
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    marginRight: 10,
                    background: sampleRamp(lens, 50, "dark"),
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    color: "#a3a3a3",
                  }}
                >
                  {lensNames[i]}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#ff2d8a" }}>
            {SITE_NAME}
          </div>
        </div>
      </div>
    ),
    { ...brandOgSize, fonts },
  );
}

/*
 * ── The site-wide card ────────────────────────────────────────────────────────
 *
 * The landing card is the same frame as above with the instrument itself behind
 * it: the landing hero's extruded score relief, captured from the running app
 * and committed at `public/hero-relief.jpg`. Everything else is subtraction. At
 * the size a share card is actually seen (a thumbnail beside a message) a stat
 * grid, a lens legend and three lines of copy are noise and none of it is read,
 * so this card carries a small wordmark, one title, one supporting line, and the
 * honesty caveat. The per-route cards above keep the lens row; the per-street
 * cards keep their numbers. This one is the image.
 */

/**
 * The relief render as a data URI.
 *
 * Read off disk rather than fetched: every `opengraph-image` route on this site
 * prerenders (`generateImageMetadata` runs during page-data collection, before
 * a request exists), so there is no origin to fetch from at the moment the card
 * is drawn, and the read happens once at BUILD time rather than per request. The
 * asset is 1600x630-proportioned and about 275 KB, so the base64 string it
 * becomes is a build-time cost and never a response-time one.
 *
 * Cached in a module-level promise so a build that renders both locales reads
 * and encodes the file once.
 */
let reliefDataUri: Promise<string> | null = null;
function reliefBackground(): Promise<string> {
  reliefDataUri ??= readFile(path.join(process.cwd(), "public", "hero-relief.jpg")).then(
    (bytes) => `data:image/jpeg;base64,${bytes.toString("base64")}`,
  );
  return reliefDataUri;
}

/**
 * The scrim, in two washes rather than one.
 *
 * The old card could get away with a single left-to-right wash held near-opaque
 * (0.90) through the text column, because the render it sat on left the whole
 * upper-left empty. The re-framed render has no empty quarter: the pilot network
 * is centred and fills the frame, so a wash strong enough to carry type would
 * have buried half the thing the card exists to show.
 *
 * So the type gets its contrast from where it is rather than from brute opacity.
 * A gentle left wash separates the copy column from the corridors behind it, and
 * a foot wash darkens the bottom third where the copy actually sits. They
 * multiply where they overlap (the lower left, under the caveat) and they leave
 * the upper middle and right, the dense downtown grid, close to full strength.
 */
const RELIEF_SIDE_SCRIM =
  "linear-gradient(90deg, rgba(10,10,10,0.62) 0%, rgba(10,10,10,0.50) 38%, rgba(10,10,10,0.26) 62%, rgba(10,10,10,0.08) 85%, rgba(10,10,10,0.00) 100%)";

const RELIEF_FOOT_SCRIM =
  "linear-gradient(180deg, rgba(10,10,10,0.00) 0%, rgba(10,10,10,0.00) 34%, rgba(10,10,10,0.22) 50%, rgba(10,10,10,0.66) 70%, rgba(10,10,10,0.88) 88%, rgba(10,10,10,0.94) 100%)";

/**
 * Break the headline on its own sentences instead of leaving it to the line
 * breaker. Both locales' `ogTitle` is two short sentences, and letting the
 * measured width decide where they break stranded a two-word fragment on a
 * third line in English. Splitting on the sentence boundary gives the same
 * break in every locale whatever the font metrics do, and a one-sentence title
 * is simply one line that still wraps if it has to.
 */
function headlineLines(title: string): string[] {
  return title
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ReliefOgInput = Readonly<{
  locale: Locale;
  title: string;
  /** The single supporting line. */
  line: string;
  /** The honesty caveat, in the landing page's own register. */
  caveat: string;
}>;

export async function renderReliefOgImage({
  locale,
  title,
  line,
  caveat,
}: ReliefOgInput): Promise<ImageResponse> {
  const municipality = getMunicipalityConfig();
  const place = `${municipality.name[locale]}, ${municipality.region[locale]}`;
  const [background, fonts] = await Promise.all([reliefBackground(), loadBrandFonts()]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0a0a0a",
          color: "#f1f1f1",
          fontFamily: BRAND_FONT_FAMILY,
        }}
      >
        {/* The render is exactly the card's aspect ratio (1600x840 against
            1200x630), so it fills the frame with nothing cropped away.
            `next/image` has nothing to do here: this tree is rendered by satori
            into a PNG, not by a browser, and satori understands a plain <img>
            with a data URI and nothing else. There is no LCP and no bandwidth to
            optimise, so the rule the disable silences does not apply. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={background}
          alt=""
          width={brandOgSize.width}
          height={brandOgSize.height}
          style={{ position: "absolute", top: 0, left: 0 }}
        />
        {[RELIEF_SIDE_SCRIM, RELIEF_FOOT_SCRIM].map((wash) => (
          <div
            key={wash}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              display: "flex",
              width: brandOgSize.width,
              height: brandOgSize.height,
              backgroundImage: wash,
            }}
          />
        ))}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ display: "flex", fontSize: 27, fontWeight: 700, color: "#ff2d8a" }}>
              {SITE_NAME}
            </div>
            <div
              style={{
                display: "flex",
                marginLeft: 14,
                fontSize: 19,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#a3a3a3",
              }}
            >
              {place}
            </div>
          </div>

          {/* Copy sits as one block at the foot of the frame rather than spread
              down the left edge. The re-framed render puts the dense downtown
              grid across the upper middle and right, which is the brightest
              thing in the image and exactly where the headline used to sit; drop
              the copy below it and the two stop fighting, with no extra surface
              and nothing added or removed. */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxWidth: 900,
                fontSize: 58,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                marginBottom: 24,
              }}
            >
              {headlineLines(title).map((sentence) => (
                <div key={sentence} style={{ display: "flex" }}>
                  {sentence}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                maxWidth: 620,
                fontSize: 26,
                lineHeight: 1.35,
                color: "#d4d4d4",
              }}
            >
              {clamp(line, 120)}
            </div>

            {/* The image is the simulated pilot dataset. It says so, at the same
                weight the landing page says it, and it is not optional. */}
            <div
              style={{
                display: "flex",
                maxWidth: 740,
                marginTop: 26,
                fontSize: 19,
                color: "#9a9a9a",
              }}
            >
              {caveat}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...brandOgSize, fonts },
  );
}
