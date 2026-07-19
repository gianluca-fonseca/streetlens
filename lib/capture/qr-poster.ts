/**
 * Bilingual printable QR poster HTML for lamppost recruitment.
 */

import type { LocaleCode } from "@/lib/municipality";

export type QrPosterInput = Readonly<{
  spotId: string;
  streetName: string;
  district: string;
  collectUrl: string;
  qrSvg: string;
  municipality: Record<LocaleCode, string>;
  projectName: string;
}>;

export function buildQrPosterHtml(input: QrPosterInput): string {
  const { streetName, district, collectUrl, qrSvg, municipality, projectName } = input;
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
    @media print { body { padding: 0; } }
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
