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
import { getTranslations } from "next-intl/server";
import { sampleRamp } from "@/components/mapConfig";
import type { Locale } from "@/i18n/routing";
import { getMunicipalityConfig } from "@/lib/municipality";
import { SITE_NAME } from "@/lib/site";

/** Shared config exports, re-exported by each route's opengraph-image file. */
export const brandOgSize = { width: 1200, height: 630 } as const;
export const brandOgContentType = "image/png";

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
  const t = await getTranslations({ locale, namespace: "layers" });
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
        <div style={{ display: "flex", flexDirection: "column" }}>
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
            {LENSES.map((lens) => (
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
                    background: sampleRamp(lens, 50),
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    color: "#a3a3a3",
                  }}
                >
                  {t(`${lens}.name`)}
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
