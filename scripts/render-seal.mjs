// scripts/render-seal.mjs
//
// Emits the Escuela Segura seal as standalone SVG files for decks, print, and
// anywhere a React component cannot go.
//
// The geometry MIRRORS components/schools/EscuelaSeguraSeal.tsx. That component
// is the authority — it is what ships on the site — and this script exists so a
// slide and a web page carry the same mark rather than two drawings that drift.
// Change one, change both; scripts/test-school-score.mjs asserts they agree.
//
// Run: `node scripts/render-seal.mjs`
// Pure Node ESM, zero dependencies, no network.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "assets");

const BARS = [
  { y: 120, half: 30, w: 7.6 },
  { y: 109, half: 24, w: 6.3 },
  { y: 99, half: 18.5, w: 5.2 },
  { y: 90, half: 13.5, w: 4.2 },
];

/** One seal. `ink` is baked in rather than left as currentColor: a file dropped
 *  into Keynote has no cascade to inherit from. */
function seal({ state, municipality, validUntil, ink }) {
  const pending = state === "pending";
  const dim = pending ? 0.4 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" fill="none" stroke="${ink}" role="img" aria-label="Escuela Segura · ${municipality}">
  <title>Escuela Segura · ${municipality}</title>
  <defs>
    <path id="top" d="M 26 100 A 74 74 0 0 1 174 100"/>
    <path id="bottom" d="M 30 100 A 70 70 0 0 0 170 100"/>
  </defs>
  <circle cx="100" cy="100" r="96" stroke-width="${pending ? 1.5 : 3}" opacity="${pending ? 0.55 : 1}"/>
  <circle cx="100" cy="100" r="88" stroke-width="0.75" opacity="0.5"/>
  ${pending ? `<circle cx="100" cy="100" r="92" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>` : ""}
  <g fill="${ink}" stroke="none">
    <text font-size="15" font-weight="600" letter-spacing="3.2" font-family="'Space Grotesk', system-ui, sans-serif">
      <textPath href="#top" startOffset="50%" text-anchor="middle">ESCUELA SEGURA</textPath>
    </text>
    <text font-size="8.5" letter-spacing="2.1" opacity="0.72" font-family="'IBM Plex Mono', ui-monospace, monospace">
      <textPath href="#bottom" startOffset="50%" text-anchor="middle">${municipality.toUpperCase()}</textPath>
    </text>
  </g>
  <g stroke-linecap="round">
${BARS.map((b) => `    <line x1="${100 - b.half}" y1="${b.y}" x2="${100 + b.half}" y2="${b.y}" stroke-width="${b.w}" opacity="${dim}"/>`).join("\n")}
  </g>
  <circle cx="100" cy="69" r="7.5" fill="${ink}" stroke="none" opacity="${dim}"/>
  <line x1="74" y1="130" x2="126" y2="130" stroke-width="0.75" opacity="0.45"/>
  <text x="100" y="142" text-anchor="middle" font-size="10" letter-spacing="1.6" fill="${ink}" stroke="none" opacity="0.72" font-family="'IBM Plex Mono', ui-monospace, monospace">${pending ? "NO ACREDITADA" : `VIGENTE ${validUntil}`}</text>
</svg>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
const municipality = "Cantón de Escazú";
const validUntil = 2028;

const files = [
  ["escuela-segura-seal-light.svg", { state: "awarded", ink: "#111111" }],
  ["escuela-segura-seal-dark.svg", { state: "awarded", ink: "#f2f2f2" }],
  ["escuela-segura-seal-pending-light.svg", { state: "pending", ink: "#111111" }],
];

for (const [name, opts] of files) {
  writeFileSync(join(OUT_DIR, name), seal({ municipality, validUntil, ...opts }));
  console.log("wrote docs/assets/%s", name);
}
