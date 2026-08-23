// scripts/build-school-route-page.mjs
//
// Renders data/route/school-route.geojson into ONE self-contained HTML page:
// the run sheet you actually hold in the car. Generated rather than authored,
// so it cannot drift from the roster the map draws.
//
// The page's job is narrow and physical. Someone is parked, has just finished
// recording one school, and needs to know which is next, how far, and how to
// make the phone start navigating — in about two seconds, one-handed, in
// daylight. Everything here serves that: the Waze control is the biggest thing
// on every row, the hop distance is the second, and the provenance a partner
// would ask about is present but never in the way.
//
// Visual language is StreetLens's own (app/globals.css, components/mapConfig.ts)
// rather than a new one: the same Space Grotesk / IBM Plex Mono / Newsreader
// trio, the same zen paper-and-ink neutrals, the same flash pink as the single
// signal, and — the detail that matters — the SAME public/private mark the map
// draws. A solid disc is público and a hollow one is privado on both surfaces,
// so the sheet and the screen teach one vocabulary, not two.
//
// Run: `node scripts/build-school-route-page.mjs`
// Pure Node ESM, Node 20+, zero dependencies, no network.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_PATH = join(ROOT, "data", "route", "school-route.geojson");
const SCHOOLS_PATH = join(ROOT, "data", "schools.geojson");
const OUT_PATH = join(ROOT, "data", "route", "school-route.html");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const route = JSON.parse(readFileSync(ROUTE_PATH, "utf8"));
const schools = JSON.parse(readFileSync(SCHOOLS_PATH, "utf8"));
const stops = route.features.filter((f) => f.geometry.type === "Point");

const LEVELS = {
  preschool: "Preescolar",
  primary: "Primaria",
  preschool_primary: "Preescolar y primaria",
  secondary: "Secundaria",
  basica_general: "Básica general",
  adult: "Adultos",
};

/** Whole-leg Google Maps links, batched at 10 so Maps never drops the tail. */
function legMapsLinks(legStops) {
  const links = [];
  for (let i = 0; i < legStops.length; i += 9) {
    const chunk = legStops.slice(i, i + 10);
    if (chunk.length < 2) break;
    links.push(
      "https://www.google.com/maps/dir/" +
        chunk
          .map((s) => `${s.geometry.coordinates[1].toFixed(6)},${s.geometry.coordinates[0].toFixed(6)}`)
          .join("/"),
    );
  }
  return links;
}

const legs = route.metadata.legs.map((meta, i) => ({
  ...meta,
  n: i + 1,
  stops: stops.filter((s) => s.properties.leg === i + 1).sort((a, b) => a.properties.stop - b.properties.stop),
}));

const totalKm = legs.reduce((m, l) => m + l.straight_line_km, 0);
const publicCount = schools.metadata.counts.public;
const privateCount = schools.metadata.counts.private;

function stopRow(s) {
  const p = s.properties;
  const [lon, lat] = s.geometry.coordinates;
  const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  const hop = p.hop_from_previous_m;
  return `
      ${
        hop === null
          ? ""
          : `<li class="hop" aria-hidden="true"><span>${
              hop >= 1000 ? `${(hop / 1000).toFixed(1)} km` : `${hop} m`
            }</span></li>`
      }
      <li class="stop">
        <div class="marker">
          <span class="num">${p.stop}</span>
          <span class="disc ${p.sector}" title="${p.sector === "public" ? "Público" : "Privado"}"></span>
        </div>
        <div class="body">
          <h3>${esc(p.name)}</h3>
          <p class="addr">${esc(p.address ?? "—")}</p>
          <p class="meta">
            <span class="sector ${p.sector}">${p.sector === "public" ? "Público" : "Privado"}</span>
            ${p.level ? `<span class="dot">·</span><span>${esc(LEVELS[p.level] ?? p.level)}</span>` : ""}
            <span class="dot">·</span><span class="code">MEP ${esc(p.mep_code ?? "—")}</span>
          </p>
          ${
            p.also_here?.length
              ? `<p class="also">También aquí: ${p.also_here.map(esc).join(" · ")}</p>`
              : ""
          }
          <p class="coords"><code>${coords}</code></p>
        </div>
        <div class="go">
          <a class="waze" href="${esc(p.waze)}">Waze</a>
          <a class="maps" href="${esc(p.maps)}">Maps</a>
        </div>
      </li>`;
}

const html = `<title>Escazú School Run Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap">
<style>
  /* ── Tokens ───────────────────────────────────────────────────────────────
     StreetLens's own palette (app/globals.css), not a new one. Light is the
     base; dark redefines only the tokens, once for the OS preference (guarded
     so an explicit light choice still wins) and once for the explicit stamp. */
  :root {
    --paper: #fafafa;
    --plate: #ffffff;
    --sunken: #f1f1f1;
    --ink: #111111;
    --ink-muted: #5c5c5c;
    --ink-faint: #9a9a9a;
    --hairline: #e4e4e4;
    --hairline-strong: #d2d2d2;
    /* The one signal. Deep magenta because it has to carry TEXT on white and
       still clear AA; the map's brighter #f0268c is a graphic-only value. */
    --accent: #c0106b;
    --accent-ink: #ffffff;
    --accent-quiet: #fdeaf3;

    --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    --font-serif: "Newsreader", ui-serif, Georgia, serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #0a0a0a;
      --plate: #141414;
      --sunken: #050505;
      --ink: #f2f2f2;
      --ink-muted: #a3a3a3;
      --ink-faint: #666666;
      --hairline: #262626;
      --hairline-strong: #363636;
      --accent: #ff4fa3;
      --accent-ink: #0a0a0a;
      --accent-quiet: #2a0f1d;
    }
  }
  :root[data-theme="dark"] {
    --paper: #0a0a0a;
    --plate: #141414;
    --sunken: #050505;
    --ink: #f2f2f2;
    --ink-muted: #a3a3a3;
    --ink-faint: #666666;
    --hairline: #262626;
    --hairline-strong: #363636;
    --accent: #ff4fa3;
    --accent-ink: #0a0a0a;
    --accent-quiet: #2a0f1d;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }

  .sheet {
    max-width: 46rem;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  @media (min-width: 40rem) { .sheet { padding: 3rem 1.5rem 5rem; } }

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  .masthead { display: flex; flex-direction: column; gap: 1rem; }
  .eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  h1 {
    margin: 0;
    font-size: clamp(1.75rem, 6vw, 2.5rem);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.1;
    text-wrap: balance;
  }
  .standfirst {
    margin: 0;
    max-width: 34em;
    font-family: var(--font-serif);
    font-size: 1.0625rem;
    line-height: 1.6;
    color: var(--ink-muted);
  }
  .figures {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
    margin: 0;
    padding: 1rem 0;
    border-block: 1px solid var(--hairline);
  }
  .figures div { display: flex; flex-direction: column; gap: 0.15rem; }
  .figures dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.375rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .figures dt {
    font-size: 0.6875rem;
    line-height: 1.3;
    color: var(--ink-muted);
  }

  .note {
    margin: 0;
    padding: 0.875rem 1rem;
    background: var(--sunken);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    font-size: 0.875rem;
    line-height: 1.55;
    color: var(--ink-muted);
  }
  .note strong { color: var(--ink); font-weight: 600; }

  /* ── Key: the same two marks the map draws ────────────────────────────── */
  .key { display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: center; }
  .key span { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--ink-muted); }

  .disc {
    width: 11px; height: 11px; border-radius: 50%;
    flex: none;
    border: 1.5px solid var(--ink);
  }
  .disc.public { background: var(--ink); }
  .disc.private { background: var(--plate); }

  /* ── Legs ─────────────────────────────────────────────────────────────── */
  .leg { display: flex; flex-direction: column; gap: 0; }
  .leg-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 0.75rem;
    padding: 0.75rem 0;
    margin-bottom: 0.5rem;
    background: var(--paper);
    border-bottom: 1px solid var(--hairline-strong);
  }
  .leg-n {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .leg-head h2 {
    margin: 0;
    flex: 1 1 auto;
    font-size: 1.1875rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .leg-stats {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
    white-space: nowrap;
  }

  ol.stops { list-style: none; margin: 0; padding: 0; }

  /* The connector carries the hop to the next stop — the second thing a driver
     wants after "which one", and true information rather than a divider. */
  .hop {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem 0 0.375rem 1.125rem;
  }
  .hop::before {
    content: "";
    width: 1px;
    align-self: stretch;
    min-height: 1.25rem;
    background: var(--hairline-strong);
  }
  .hop span {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint);
  }

  .stop {
    display: grid;
    grid-template-columns: 2.25rem 1fr;
    gap: 0 0.75rem;
    padding: 0.875rem;
    background: var(--plate);
    border: 1px solid var(--hairline);
    border-radius: 10px;
  }
  @media (min-width: 34rem) {
    .stop { grid-template-columns: 2.25rem 1fr auto; align-items: start; }
  }

  .marker { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding-top: 0.1rem; }
  .num {
    font-family: var(--font-mono);
    font-size: 1.0625rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--ink);
  }

  .body { min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .body h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .addr { margin: 0; font-size: 0.875rem; line-height: 1.4; color: var(--ink-muted); }
  .meta {
    margin: 0.15rem 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--ink-muted);
  }
  .meta .dot { color: var(--ink-faint); }
  .sector { text-transform: uppercase; letter-spacing: 0.08em; }
  .sector.public { color: var(--ink); font-weight: 600; }
  .also {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--ink-muted);
    padding-left: 0.625rem;
    border-left: 2px solid var(--hairline-strong);
  }
  .coords { margin: 0.15rem 0 0; }
  .coords code {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint);
    user-select: all;
  }

  /* The control the whole page exists to deliver. Full width on a phone,
     because that is the hand it will be tapped with. */
  .go {
    grid-column: 1 / -1;
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  @media (min-width: 34rem) {
    .go { grid-column: auto; margin-top: 0; flex-direction: column; width: 6rem; }
    /* Keep the controls at their own height rather than stretching to the row.
       A taller row (one with hosted programmes listed) would otherwise grow its
       buttons, and a column of buttons that change size row to row reads as a
       layout accident. */
    .go a { flex: 0 0 auto; }
  }

  .go a {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 0.875rem;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-decoration: none;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  .waze { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  .waze:hover { background: var(--ink); border-color: var(--ink); color: var(--plate); }
  .maps { background: transparent; color: var(--ink); border: 1px solid var(--hairline-strong); }
  .maps:hover { border-color: var(--ink); }

  .leg-foot { margin-top: 0.875rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; }
  .leg-foot p { margin: 0; font-size: 0.75rem; color: var(--ink-muted); }
  .leg-foot a { color: var(--accent); font-size: 0.8125rem; font-weight: 500; text-decoration: none; border-bottom: 1px solid currentColor; }
  .leg-foot a:hover { color: var(--ink); }

  footer {
    padding-top: 1.5rem;
    border-top: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }
  footer p { margin: 0; font-size: 0.8125rem; line-height: 1.55; color: var(--ink-muted); }
  footer code { font-family: var(--font-mono); font-size: 0.75rem; color: var(--ink); }

  a:focus-visible, code:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
  @media print {
    .go a, .leg-head { break-inside: avoid; }
    .stop { break-inside: avoid; }
  }
</style>

<div class="sheet">
  <header class="masthead">
    <p class="eyebrow">StreetLens · Cantón de Escazú · Field collection</p>
    <h1>Every school in Escazú, in the order to drive them</h1>
    <p class="standfirst">
      ${stops.length} centros educativos from the MEP register, cut into ${legs.length} afternoons.
      Tap Waze on a row and it starts navigating to that school. When you finish
      recording, tap the next one.
    </p>
    <dl class="figures">
      <div><dd>${stops.length}</dd><dt>Schools</dt></div>
      <div><dd>${publicCount} / ${privateCount}</dd><dt>Público / privado</dt></div>
      <div><dd>${totalKm.toFixed(1)}</dd><dt>km between stops</dt></div>
    </dl>
    <div class="key">
      <span><i class="disc public"></i>Público (MEP)</span>
      <span><i class="disc private"></i>Privado</span>
    </div>
    <p class="note">
      <strong>This is a visiting order, not a driving route.</strong> It knows
      nothing about one-way streets, the Próspero Fernández, or which quebrada
      has no bridge — Waze does that part. What the sheet settles is which
      school is next. Waze takes one stop at a time; the link at the foot of
      each leg opens the whole leg in Google Maps if you want to see it as one line.
    </p>
  </header>

${legs
  .map(
    (l) => `  <section class="leg">
    <div class="leg-head">
      <span class="leg-n">Leg ${l.n}</span>
      <h2>${esc(l.title)}</h2>
      <span class="leg-stats">${l.stops.length} stops · ${l.straight_line_km.toFixed(1)} km</span>
    </div>
    <ol class="stops">${l.stops.map(stopRow).join("")}
    </ol>
    <div class="leg-foot">
      <p>${esc(l.districts.join(" / "))}</p>
      ${legMapsLinks(l.stops)
        .map(
          (url, i, arr) =>
            `<a href="${esc(url)}">Whole leg in Google Maps${arr.length > 1 ? ` (${i + 1}/${arr.length})` : ""}</a>`,
        )
        .join("")}
    </div>
  </section>`,
  )
  .join("\n")}

  <footer>
    <p>
      Roster: the Ministerio de Educación Pública's own register, queried from
      SIGMEP (<code>MEP_CEPUBCR_1</code> público, <code>MEP_CEPRIVCR_1</code>
      privado). Positions sharpened against OpenStreetMap campus geometry where
      it exists; addresses reverse-geocoded from the final position. Every
      site's provenance, including the two registry rows this sheet deliberately
      drops, is in <code>data/schools.geojson</code>.
    </p>
    <p>
      Regenerate with <code>node scripts/build-schools.mjs</code> then
      <code>node scripts/build-school-route.mjs</code> and
      <code>node scripts/build-school-route-page.mjs</code>.
    </p>
  </footer>
</div>
`;

writeFileSync(OUT_PATH, html);
console.log(
  "wrote %s — %d stops across %d legs, %s km",
  OUT_PATH,
  stops.length,
  legs.length,
  totalKm.toFixed(1),
);
