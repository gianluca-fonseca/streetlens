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
          fontFamily: "system-ui, sans-serif",
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
    { ...brandOgSize },
  );
}
