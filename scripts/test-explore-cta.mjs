#!/usr/bin/env node
/**
 * test-explore-cta.mjs (bgsd-0018)
 *
 * Locks the map aside's explore invitation. Four contracts matter, and each one
 * fails silently in a browser drive if it regresses:
 *
 *   1. SEMANTICS. It navigates, so it must stay a locale-aware <Link> to a real
 *      route, never a div or a click-handler button.
 *   2. ACCESSIBLE NAME. The name comes from visible, message-bound label text,
 *      and the arrow is decorative (aria-hidden), so the name never degrades to
 *      an icon-only or empty link.
 *   3. BOTH LOCALES. EN and ES both carry non-empty label copy.
 *   4. REDUCED MOTION. The looping nudge is CANCELLED, not merely shortened,
 *      and the motion is transform-only so the row can never shift layout.
 *
 * Plus: the row survives the aside collapse (it sits outside the collapsible
 * blocks), which is the whole reason it exists.
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

/** The reduced-motion at-rule body, or "" if there is none. */
function reducedMotionBlock(source) {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

const cta = read("components/ExploreCta.tsx");
const css = read("components/ui/explore-cta.module.css");
const panel = read("components/MapPanel.tsx");

console.log("semantics — it navigates, so it is a link");
check(
  "renders the locale-aware Link from i18n/navigation",
  cta.includes('import { Link } from "@/i18n/navigation"') &&
    /<Link\b/.test(cta),
);
check(
  "points at a real secondary route, reachable in one interaction",
  /href="\/insights"/.test(cta),
);
check(
  "is not a fake link (no onClick-driven button or div)",
  !/<button\b/.test(cta) && !/onClick=/.test(cta),
);

console.log("");
console.log("accessible name — visible label text, decorative arrow");
check(
  "the label renders from the panel message namespace",
  cta.includes('useTranslations("panel")') && cta.includes('t("explore")'),
);
check(
  "no aria-label overrides the visible text (label-in-name holds)",
  !/aria-label/.test(cta),
);
check(
  "the arrow glyph is hidden from the accessibility tree",
  /aria-hidden="true"[\s\S]{0,160}ArrowRight/.test(cta),
);
check(
  "keyboard focus is visible",
  cta.includes("focus-visible:ring-2") && cta.includes("focus-visible:ring-ink"),
);
check(
  "the tap target clears 44px",
  cta.includes("min-h-[44px]"),
);

console.log("");
console.log("mounted in the aside, and it survives the collapse");
check(
  "MapPanel renders the CTA",
  panel.includes('import ExploreCta from "@/components/ExploreCta"') &&
    panel.includes("<ExploreCta />"),
);
check(
  "the CTA sits outside every collapsible block",
  !/collapsibleInner[\s\S]*?<ExploreCta[\s\S]*?<\/div>/.test(panel),
);
// The left column also carries the 3D toggle above the contribute button, so
// every pixel the aside grows pushes that toggle down. The footer goes full
// bleed and takes over the panel's own bottom padding, which is what keeps the
// invitation to ~44px of column instead of ~66px.
check(
  "the footer reclaims the panel's own bottom padding",
  cta.includes("-mx-4") && cta.includes("border-t") && panel.includes("pb-0"),
);
// The aside caps its height and scrolls (Spanish overflows at 1440x900), so an
// unpinned footer would scroll out of sight. Pinned, and opaque so the content
// passing beneath it cannot ghost through the label.
check(
  "the aside is height budgeted and scrolls rather than pushing the column",
  panel.includes("max-h-[calc(100%-3.25rem)]") &&
    panel.includes("overflow-y-auto"),
);
check(
  "the footer is pinned to the bottom of the scrolling aside, opaque",
  cta.includes("sticky bottom-0") && cta.includes("bg-surface-elevated"),
);

console.log("");
console.log("i18n parity for the explore copy");
for (const loc of ["en", "es"]) {
  const messages = JSON.parse(read(`messages/${loc}.json`)).panel;
  check(
    `${loc}: panel.explore is non-empty`,
    typeof messages.explore === "string" && messages.explore.trim().length > 0,
  );
}

console.log("");
console.log("reduced motion — the loop is cancelled, not shortened");
const reduced = reducedMotionBlock(css);
check("an authored reduced-motion block exists", reduced.length > 0);
check(
  "the looping nudge is disabled outright",
  /\.arrow\s*\{[^}]*animation:\s*none/.test(reduced),
);
check(
  "no reduced variant merely slows the loop down",
  !/animation-duration/.test(reduced) &&
    !/animation:\s*exploreNudge/.test(reduced),
);
check(
  "the hover/focus step is neutralised too",
  /transition:\s*none/.test(reduced) && /transform:\s*none/.test(reduced),
);
check(
  "every animated class is covered by the reduced block",
  ["arrow", "arrowTrack"].every((cls) => reduced.includes(`.${cls}`)),
);

console.log("");
console.log("no cumulative layout shift — transform-only motion");
const animatedProps = [...css.matchAll(/transform:\s*([^;]+);/g)].map((m) =>
  m[1].trim(),
);
check(
  "keyframes and hover states only ever set transform",
  animatedProps.length > 0 &&
    !/(width|height|margin|padding|top|left|right|bottom|inset)\s*:/.test(
      css.slice(css.indexOf("@keyframes")),
    ),
);
check(
  "the nudge travel stays small (≤4px)",
  [...css.matchAll(/translateX\((-?\d+(?:\.\d+)?)px\)/g)].every(
    (m) => Math.abs(Number(m[1])) <= 4,
  ),
);

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — explore CTA contracts hold");
