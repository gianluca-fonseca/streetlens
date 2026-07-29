#!/usr/bin/env node
/**
 * test-landing-hero-chrome.mjs (the landing's orienting chrome)
 *
 * Four marks that answer "where am I, in what language, and is this the whole
 * page?" — each of which was previously missing or misplaced, and each of which
 * is invisible to a type-check because it is layout and copy, not types:
 *
 *   1. The Costa Rican flag leads the pilot chip. It used to sit in the banner,
 *      far from the line that names the country, so the two read as unrelated.
 *      Inside the chip it must be DECORATIVE — the chip's own text already says
 *      "Costa Rica", and a labelled flag makes a screen reader say it twice.
 *   2. The map plate is labelled with its place. The relief is a reading of one
 *      canton, and nothing on the frame said which.
 *   3. The document cue points at a section that actually exists. A hash anchor
 *      is only as good as its target id, and nothing else in the build would
 *      catch `#mission` going stale.
 *   4. The landing carries the EN/ES switch, and that switch is styled in
 *      currentColor. The banner is an INVERTED plate (near-black ground, paper
 *      ink); a switch styled in fixed ink tokens renders near-black on black in
 *      light mode — present in the DOM, invisible on screen. This is the one
 *      failure mode a "does it render" check would sail straight past.
 *
 * Source-level assertions: these are JSX and CSS contracts, so the test reads
 * the files rather than mounting a renderer (the repo has no DOM harness).
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const hero = read("components/landing/Hero.tsx");
const flag = read("components/ui/FlagCR.tsx");
const localeSwitcher = read("components/LocaleSwitcher.tsx");
const mission = read("components/landing/MissionSection.tsx");
const css = read("app/globals.css");
const msgs = Object.fromEntries(
  ["en", "es"].map((loc) => [loc, JSON.parse(read(`messages/${loc}.json`))]),
);
const heroMsgs = (loc) => msgs[loc].landing.hero;

/** The Banner() body: everything from `function Banner()` to the next top-level
 * `function`, so "in the banner" can be asserted apart from "in the hero". */
function bannerSource() {
  const start = hero.indexOf("function Banner()");
  if (start < 0) return "";
  const rest = hero.slice(start + 1);
  const end = rest.indexOf("\nfunction ");
  return end < 0 ? rest : rest.slice(0, end);
}
const banner = bannerSource();

// ── 1. The flag leads the pilot chip, and left the banner ────────────────────
console.log("the flag marks the pilot chip, not the banner");
check("Banner() was found in Hero.tsx", banner.length > 0);
check("the banner no longer draws the flag", !banner.includes("FlagCR"));
check(
  "the pilot chip draws the flag",
  /<FlagCR[^>]*\/>\s*\n\s*\{t\("pilot"\)\}/.test(hero),
  "(flag must immediately precede the pilot copy)",
);
check(
  "the flag in the chip is decorative",
  /<FlagCR\s+decorative\b/.test(hero),
  "(the chip text already says Costa Rica)",
);
check(
  "FlagCR supports a decorative mode",
  /decorative/.test(flag) && /"aria-hidden": true/.test(flag),
);
check(
  "FlagCR still labels itself when NOT decorative",
  /role: "img"/.test(flag) && /"aria-label": "Costa Rica"/.test(flag),
);
for (const loc of ["en", "es"]) {
  check(
    `${loc}: the retired banner origin key is gone`,
    heroMsgs(loc).banner.origin === undefined,
  );
  check(
    `${loc}: the pilot chip still names the country`,
    /costa rica/i.test(heroMsgs(loc).pilot),
    JSON.stringify(heroMsgs(loc).pilot),
  );
}

// ── 2. The map plate is labelled with its place ──────────────────────────────
console.log("the map plate names the place it shows");
check("the hero renders the plate label", hero.includes('{t("map.place")}'));
check("the plate label carries its note", hero.includes('{t("map.placeNote")}'));
check(
  "the label sits ABOVE the map frame",
  hero.indexOf('{t("map.place")}') < hero.indexOf("<AuditMap"),
);
check(
  "the label is a heading, not loose text",
  /<h2[^>]*>\s*\{t\("map\.place"\)\}/.test(hero),
);
for (const loc of ["en", "es"]) {
  const m = heroMsgs(loc).map;
  check(`${loc}: map.place names Escazú`, /escaz/i.test(m.place ?? ""), JSON.stringify(m.place));
  check(`${loc}: map.placeNote is set`, typeof m.placeNote === "string" && m.placeNote.length > 0);
}

// ── 3. The document cue resolves to a real section ───────────────────────────
console.log("the document cue points somewhere");
check("the hero renders the cue", hero.includes("<ScrollCue"));
check("the cue is labelled from messages", hero.includes('{t("scrollCue")}'));
const cueHref = hero.match(/href="#([a-z-]+)"/);
check("the cue is a hash anchor (works with JS off)", !!cueHref, cueHref?.[0] ?? "");
check(
  "the cue's target section exists",
  !!cueHref && mission.includes(`id="${cueHref[1]}"`),
  cueHref ? `#${cueHref[1]}` : "",
);
check(
  "the cue sits after the street list",
  hero.indexOf("<ScrollCue") > hero.lastIndexOf("<SegmentRow"),
);
check("the cue's chevron animates", /className="sl-scroll-cue"/.test(hero));
check("the drift keyframes exist", css.includes("@keyframes sl-cue-drift"));
check(
  "the cue rests under reduced motion",
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sl-scroll-cue\s*\{[\s\S]*?animation: none/.test(css),
  "(motion carries no meaning here; the label does)",
);
for (const loc of ["en", "es"]) {
  check(
    `${loc}: scrollCue is set`,
    typeof heroMsgs(loc).scrollCue === "string" && heroMsgs(loc).scrollCue.length > 0,
    JSON.stringify(heroMsgs(loc).scrollCue),
  );
}
check(
  "EN and ES cue copy actually differ",
  heroMsgs("en").scrollCue !== heroMsgs("es").scrollCue,
);

// ── 4. The landing carries a language switch that can be SEEN ────────────────
console.log("the landing banner carries a legible EN/ES switch");
check("the banner mounts the locale switch", banner.includes("<LocaleSwitcher"));
check(
  "the switch is imported",
  hero.includes('from "@/components/LocaleSwitcher"'),
);
check(
  "the switch keeps the theme switch company",
  banner.includes("<ThemeSwitcher"),
);
// The inverted-plate rule: no fixed ink token may decide this component's colour.
for (const token of ["text-ink-display", "text-ink-muted", "text-ink\"", "text-paper"]) {
  check(
    `the switch does not hardcode ${token.replace('"', "")}`,
    !localeSwitcher.includes(token),
    "(would go invisible on the banner's black plate)",
  );
}
check(
  "the switch marks the active locale without colour",
  /font-medium/.test(localeSwitcher) && /opacity-/.test(localeSwitcher),
);
check(
  "the switch's focus ring inherits too",
  localeSwitcher.includes("focus-visible:ring-current"),
);
check(
  "both locales are offered",
  /code: "en"/.test(localeSwitcher) && /code: "es"/.test(localeSwitcher),
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("");
if (failures.length) {
  console.error(`FAIL — ${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS — landing hero chrome contract holds.");
