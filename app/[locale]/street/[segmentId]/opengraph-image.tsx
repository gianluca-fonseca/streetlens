import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
// The card ground is #0a0a0a, so it samples the DARK half of the ramp — the
// same half the dark basemap paints (mapConfig rev 8).
import { sampleRamp } from "@/components/mapConfig";
import type { Locale } from "@/i18n/routing";
import { BRAND_FONT_FAMILY, loadBrandFonts } from "@/lib/og-brand";
import { getStreetCard } from "@/lib/street-card";

export const runtime = "nodejs";
export const alt = "StreetLens street report card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type OgProps = Readonly<{
  params: Promise<{ locale: Locale; segmentId: string }>;
}>;

export default async function OgImage({ params }: OgProps) {
  const { locale, segmentId } = await params;
  const card = await getStreetCard(segmentId, locale);
  const t = await getTranslations({ locale, namespace: "street.og" });
  // The same vendored Space Grotesk the other nine cards draw with. Satori has
  // no font fallback chain, so this is the whole typographic contract for the
  // card: without it every street report renders in satori's bundled Geist.
  const fonts = await loadBrandFonts();

  if (!card) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            color: "#f1f1f1",
            fontSize: 36,
            fontFamily: BRAND_FONT_FAMILY,
          }}
        >
          StreetLens
        </div>
      ),
      { ...size, fonts },
    );
  }

  // The share card is a shared, crawler-fetched artifact, so it renders the
  // build-time demo default rather than any one browser's cookie. When no audit
  // stands behind this street the figures are simply absent: a 96px "0" in a
  // link preview is the loudest orphaned zero the site could ship.
  const overallColor = sampleRamp("overall", card.scores.overall, "dark");

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 18,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#a3a3a3",
                marginBottom: 8,
              }}
            >
              {t("eyebrow")}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                marginBottom: 8,
              }}
            >
              {card.name}
            </div>
            <div style={{ display: "flex", fontSize: 28, color: "#d4d4d4" }}>{card.district}</div>
          </div>
          {card.hasAudit ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 18,
                  color: "#a3a3a3",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {t("overall")}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 96,
                  fontWeight: 700,
                  color: overallColor,
                  lineHeight: 1,
                }}
              >
                {card.scores.overall}
              </div>
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: "1px solid #262626",
            paddingTop: 28,
          }}
        >
          {card.hasAudit ? (
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: 32 }}>
              <div style={{ display: "flex", fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                {t("layers.accessibility")}
              </div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: sampleRamp("accessibility", card.scores.accessibility, "dark") }}>
                {card.scores.accessibility}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginRight: 32 }}>
              <div style={{ display: "flex", fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                {t("layers.drainage")}
              </div>
              <div
                style={{ display: "flex", fontSize: 32, fontWeight: 600, color: sampleRamp("drainage", card.scores.drainage, "dark") }}
              >
                {card.scores.drainage}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginRight: 32 }}>
              <div style={{ display: "flex", fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                {t("layers.shade")}
              </div>
              <div
                style={{ display: "flex", fontSize: 32, fontWeight: 600, color: sampleRamp("shade", card.scores.shade, "dark") }}
              >
                {card.scores.shade}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                {t("layers.bike")}
              </div>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: sampleRamp("bike", card.scores.bike, "dark") }}>
                {card.scores.bike}
              </div>
            </div>
          </div>
          ) : (
            <div style={{ display: "flex", maxWidth: 760, fontSize: 24, lineHeight: 1.35, color: "#a3a3a3" }}>
              {t("unaudited")}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#ff2d8a" }}>StreetLens</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
