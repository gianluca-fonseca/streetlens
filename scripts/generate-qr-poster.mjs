#!/usr/bin/env node
/**
 * generate-qr-poster.mjs — printable bilingual QR poster for a segment spot.
 *
 * Usage:
 *   node scripts/generate-qr-poster.mjs --spot esc-sa-0001 [--locale en] [--origin http://localhost:3584] [--out poster.html]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { spot: null, locale: "en", origin: "http://localhost:3584", out: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spot" && argv[i + 1]) out.spot = argv[++i];
    else if (arg === "--locale" && argv[i + 1]) out.locale = argv[++i];
    else if (arg === "--origin" && argv[i + 1]) out.origin = argv[++i];
    else if ((arg === "--out" || arg === "-o") && argv[i + 1]) out.out = argv[++i];
  }
  return out;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function municipalityNames() {
  return {
    en: process.env.NEXT_PUBLIC_MUNICIPALITY_NAME_EN?.trim() || "your municipality",
    es: process.env.NEXT_PUBLIC_MUNICIPALITY_NAME_ES?.trim() || "su municipio",
  };
}

function buildPosterHtml({ streetName, district, collectUrl, qrSvg, municipality, projectName }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(streetName)} — ${escapeHtml(projectName)} QR</title>
  <style>
    @page { size: A4 portrait; margin: 18mm; }
    body { font-family: system-ui, sans-serif; color: #111; margin: 0; padding: 24px; }
    .plate { border: 2px solid #111; border-radius: 8px; padding: 24px; max-width: 480px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; border-top: 1px solid #ccc; padding-top: 16px; }
    .meta { font-size: 13px; color: #444; margin-bottom: 16px; }
    .qr { display: block; margin: 16px auto; width: 200px; height: 200px; }
    .steps { font-size: 14px; line-height: 1.5; padding-left: 18px; }
    .footer { margin-top: 20px; font-size: 11px; color: #666; word-break: break-all; }
  </style>
</head>
<body>
  <div class="plate">
    <h1>${escapeHtml(projectName)}</h1>
    <p class="meta"><strong>${escapeHtml(streetName)}</strong> · ${escapeHtml(district)}</p>
    ${qrSvg.replace("<svg", '<svg class="qr"')}
    <h2>English</h2>
    <p class="meta">${escapeHtml(municipality.en)}</p>
    <ol class="steps">
      <li>Scan this code with your phone camera.</li>
      <li>Walk this street at a normal pace, camera forward.</li>
      <li>Upload when done — a reviewer checks it before it goes public.</li>
    </ol>
    <h2>Español</h2>
    <p class="meta">${escapeHtml(municipality.es)}</p>
    <ol class="steps">
      <li>Escanee este código con la cámara del teléfono.</li>
      <li>Camine esta calle a paso normal, cámara hacia adelante.</li>
      <li>Suba al terminar — un revisor lo revisa antes de publicarlo.</li>
    </ol>
    <p class="footer">${escapeHtml(collectUrl)}</p>
  </div>
</body>
</html>`;
}

function segmentFromGeojson(spotId) {
  const geo = JSON.parse(readFileSync(path.join(ROOT, "data", "segments.geojson"), "utf8"));
  const feature = geo.features.find((f) => f.properties?.id === spotId);
  if (!feature) return null;
  return {
    id: feature.properties.id,
    name: feature.properties.name ?? spotId,
    district: feature.properties.district ?? "",
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.spot) {
    console.error(
      "Usage: node scripts/generate-qr-poster.mjs --spot <segment-id> [--locale en] [--origin URL] [--out file.html]",
    );
    process.exit(1);
  }

  const segment = segmentFromGeojson(args.spot);
  if (!segment) {
    console.error(`Segment not found: ${args.spot}`);
    process.exit(1);
  }

  const collectUrl = `${args.origin.replace(/\/$/, "")}/${args.locale}/collect?src=qr&spot=${encodeURIComponent(args.spot)}`;
  const qrSvg = await QRCode.toString(collectUrl, { type: "svg", margin: 1, width: 200 });
  const municipality = municipalityNames();
  const projectName = process.env.NEXT_PUBLIC_PROJECT_NAME?.trim() || "StreetLens";

  const html = buildPosterHtml({
    streetName: segment.name,
    district: segment.district,
    collectUrl,
    qrSvg,
    municipality,
    projectName,
  });

  const outPath =
    args.out ??
    path.join(ROOT, `.planning/evidence/unit-capture-delight/qr-poster-${args.spot}.html`);
  writeFileSync(outPath, html, "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(collectUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
