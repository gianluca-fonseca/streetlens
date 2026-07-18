/*
 * The map's theme SOURCE is the app theme store — never the raw OS query (#27).
 *
 * The bug this locks out: components/AuditMap.tsx used to own a private
 * prefersDark() built on window.matchMedia("(prefers-color-scheme: dark)"), so
 * the MapLibre instrument asked the operating system directly and the in-app
 * switcher could not move it. Toggling the app to light on a dark Mac left the
 * whole map painted dark against a light page.
 *
 * The rule, asserted here as a static source check: exactly two modules may
 * query prefers-color-scheme — lib/theme.ts (the resolver plus the pre-paint
 * init script) and components/ThemeProvider.tsx (the store's live-OS listener).
 * Every other module, the map above all, must derive from those.
 *
 * A grep test rather than a render test on purpose: the defect is architectural
 * (WHO is allowed to ask the OS), it is one line to reintroduce, and it is
 * invisible to a DOM assertion whenever the app theme and the OS theme happen
 * to agree — which is the common case, and exactly why it shipped.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Every .ts/.tsx source file under the app's own directories. */
function sourceFiles() {
  const roots = ["components", "lib", "app"];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  for (const r of roots) walk(join(ROOT, r));
  return out;
}

// The only modules permitted to ask the OS directly.
const ALLOWED = new Set(["lib/theme.ts", "components/ThemeProvider.tsx"]);

/*
 * Match the QUERY, not the word. Prose is allowed to name prefers-color-scheme
 * (AuditMap's own comments explain at length why it must not ask the OS, and a
 * bare substring check would fail on the explanation of the fix). What is banned
 * is executing the media query: matchMedia("(prefers-color-scheme...".
 */
const OS_QUERY = /matchMedia\(\s*[`'"]\(prefers-color-scheme/;

console.log("map theme source — the switcher owns the instrument (#27)");
{
  const offenders = [];
  for (const file of sourceFiles()) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    if (OS_QUERY.test(src)) offenders.push(rel);
  }
  check(
    "no module outside lib/theme.ts + ThemeProvider.tsx queries prefers-color-scheme",
    offenders.length === 0,
    offenders.join(", "),
  );
}

{
  const src = readFileSync(join(ROOT, "components/AuditMap.tsx"), "utf8");

  check(
    "AuditMap no longer defines a private prefersDark() helper",
    !/function\s+prefersDark\s*\(/.test(src),
  );

  check(
    "AuditMap derives its theme from the useTheme() store",
    src.includes("useTheme") && src.includes('resolved === "dark"'),
  );

  check(
    "AuditMap seeds its once-created map effect from the theme resolver",
    src.includes("resolveTheme(readStoredPreference())"),
  );

  // The reduced-motion and pointer queries are unrelated and must survive: this
  // test bans the COLOR-SCHEME query specifically, not matchMedia as such.
  check(
    "AuditMap keeps its reduced-motion query (not collateral damage)",
    src.includes("prefers-reduced-motion"),
  );
}

console.log(
  failures === 0
    ? "\nmap theme source: all checks passed"
    : `\nmap theme source: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
