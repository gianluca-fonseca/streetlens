#!/usr/bin/env node
/**
 * test-demo-runtime-toggle.mjs — the demo era is ON by default and flippable at
 * runtime, without a rebuild.
 *
 * Four contracts, in order:
 *   1. RESOLUTION. `showDemoData()` defaults ON (only the exact string "false"
 *      turns it off) and `resolveDemoData()` lets the cookie win in BOTH
 *      directions.
 *   2. PROVIDER. The resolved boolean actually reaches a client component:
 *      DemoDataProvider is compiled and rendered for real, and `useDemoData()`
 *      throws outside it so a missing wire is loud rather than silently false.
 *   3. SINGLE READER. `process.env.NEXT_PUBLIC_SHOW_DEMO_DATA` appears in
 *      exactly one place in the source tree, and no client component reads it.
 *      A second reader would be a source of truth that the cookie cannot
 *      override, which is the whole bug class this unit exists to prevent.
 *   4. WIRING + HONESTY. The layout resolves once and provides, every data-layer
 *      caller passes the resolved flag, the switch is a real accessible control,
 *      and the DemoBanner stays non-dismissable while the data is on.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-demo-toggle");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Source with comments removed, for the checks that assert what the CODE does.
 * Every file here documents the flag in prose, so a raw substring scan would
 * flag the explanation as the violation it is explaining.
 */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/demo-flag.ts",
      "components/DemoDataProvider.tsx",
      "--outDir", BUILD_DIR,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2019",
      "--jsx", "react-jsx",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
}

compile();

// ── 1. Resolution: default ON, cookie wins both ways ─────────────────────────
console.log("flag resolution");
const flag = require(path.join(BUILD_DIR, "lib", "demo-flag.js"));

const withEnv = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(
    process.env,
    "NEXT_PUBLIC_SHOW_DEMO_DATA",
  );
  const prev = process.env.NEXT_PUBLIC_SHOW_DEMO_DATA;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SHOW_DEMO_DATA;
  else process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = value;
  try {
    return fn();
  } finally {
    if (had) process.env.NEXT_PUBLIC_SHOW_DEMO_DATA = prev;
    else delete process.env.NEXT_PUBLIC_SHOW_DEMO_DATA;
  }
};

check(
  "env unset -> demo data ON (the deploy default)",
  withEnv(undefined, () => flag.showDemoData()) === true,
);
check(
  'env "false" -> build-time default OFF',
  withEnv("false", () => flag.showDemoData()) === false,
);
check(
  'env "true" -> ON',
  withEnv("true", () => flag.showDemoData()) === true,
);

check(
  "no cookie -> falls through to the build-time default (ON)",
  withEnv(undefined, () => flag.resolveDemoData(undefined)) === true,
);
check(
  "no cookie -> falls through to the build-time default (OFF)",
  withEnv("false", () => flag.resolveDemoData(undefined)) === false,
);
check(
  'cookie "off" overrides a default-ON build',
  withEnv(undefined, () => flag.resolveDemoData("off")) === false,
);
check(
  'cookie "on" overrides a default-OFF build',
  withEnv("false", () => flag.resolveDemoData("on")) === true,
);
check(
  "garbage cookie value is ignored, not treated as off",
  withEnv(undefined, () => flag.resolveDemoData("maybe")) === true,
);
check(
  "empty cookie value is ignored, not treated as off",
  withEnv(undefined, () => flag.resolveDemoData("")) === true,
);
check(
  "cookie name is stable",
  flag.DEMO_DATA_COOKIE === "sl_demo_data",
  `(${flag.DEMO_DATA_COOKIE})`,
);
check(
  "cookie lives at least a month",
  flag.DEMO_DATA_COOKIE_MAX_AGE >= 60 * 60 * 24 * 30,
  `(${flag.DEMO_DATA_COOKIE_MAX_AGE}s)`,
);

// ── 2. Provider: the resolved value reaches a client component ───────────────
console.log("");
console.log("provider reaches a client component");
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const provider = require(
    path.join(BUILD_DIR, "components", "DemoDataProvider.js"),
  );
  const DemoDataProvider = provider.default;
  const { useDemoData } = provider;

  // Stand-in for Hero / MapPanel / GapSection / PilotSection: a client component
  // whose only knowledge of the era is what the provider hands it.
  const Consumer = () =>
    React.createElement("span", null, useDemoData() ? "demo-on" : "demo-off");

  const render = (value) =>
    renderToStaticMarkup(
      React.createElement(
        DemoDataProvider,
        { value },
        React.createElement(Consumer, null),
      ),
    );

  check("provider value true reaches the consumer", render(true).includes("demo-on"));
  check("provider value false reaches the consumer", render(false).includes("demo-off"));

  let threw = false;
  try {
    renderToStaticMarkup(React.createElement(Consumer, null));
  } catch {
    threw = true;
  }
  check("useDemoData outside the provider throws (no silent default)", threw);
}

// ── 3. showDemoData() is the ONLY reader of the raw env var ──────────────────
console.log("");
console.log("single env reader");
{
  const files = execFileSync(
    "git",
    ["ls-files", "*.ts", "*.tsx"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  const readers = files.filter((f) =>
    code(f).includes("process.env.NEXT_PUBLIC_SHOW_DEMO_DATA"),
  );
  check(
    "exactly one source file reads the raw env var",
    readers.length === 1 && readers[0] === "lib/demo-flag.ts",
    `(${readers.join(", ") || "none"})`,
  );

  const occurrences =
    code("lib/demo-flag.ts").split("process.env.NEXT_PUBLIC_SHOW_DEMO_DATA").length - 1;
  check("it reads it exactly once", occurrences === 1, `(${occurrences})`);
  check(
    "showDemoData() is documented as the build-time default",
    /BUILD-TIME default/.test(read("lib/demo-flag.ts")),
  );
  check(
    "resolveDemoData() is exported",
    read("lib/demo-flag.ts").includes("export function resolveDemoData"),
  );

  // A client component calling showDemoData() would read the value webpack
  // inlined at build time and miss the cookie entirely.
  const clientReaders = files.filter((f) => {
    const src = code(f);
    return src.includes('"use client"') && src.includes("showDemoData");
  });
  check(
    "no client component calls showDemoData()",
    clientReaders.length === 0,
    `(${clientReaders.join(", ")})`,
  );

  // Same trap on the server side: next/headers cannot be imported from client code.
  const serverAccessorImporters = files.filter((f) => {
    const src = code(f);
    return src.includes('"use client"') && src.includes("demo-flag-server");
  });
  check(
    "no client component imports the server accessor",
    serverAccessorImporters.length === 0,
    `(${serverAccessorImporters.join(", ")})`,
  );

  // lib/segments.ts is compiled and required by the plain-Node smoke harnesses;
  // a next/headers import there would break every one of them.
  check(
    "lib/segments.ts does not import next/headers",
    !read("lib/segments.ts").includes("next/headers"),
  );
}

// ── 4. Wiring: resolved once, threaded everywhere, honest ────────────────────
console.log("");
console.log("server wiring");
{
  const layout = read("app/[locale]/layout.tsx");
  check("locale layout resolves the flag", layout.includes("await demoDataEnabled()"));
  check("locale layout renders the provider", layout.includes("<DemoDataProvider"));

  const server = read("lib/demo-flag-server.ts");
  check("server accessor reads the cookie", server.includes("cookies()"));
  check("server accessor delegates to resolveDemoData", server.includes("resolveDemoData("));

  // Every data-layer call must pass a resolved flag. A bare getSegments() would
  // silently fall back to the build-time default and ignore the switch.
  const appAndLib = execFileSync(
    "git",
    ["ls-files", "app/*.ts", "app/*.tsx", "lib/*.ts"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => f !== "lib/segments.ts");

  const bare = [];
  for (const f of appAndLib) {
    const src = read(f);
    if (/\bgetSegments\(\)/.test(src) || /\bgetStats\(\)/.test(src)) bare.push(f);
  }
  check(
    "no app/ or lib/ caller leaves getSegments()/getStats() unargued",
    bare.length === 0,
    `(${bare.join(", ")})`,
  );

  const era = read("lib/real-data-era.ts");
  check(
    "hideAuditedZeros takes the resolved flag",
    /hideAuditedZeros\(\s*stats: StreetStats,\s*demoEnabled: boolean,?\s*\)/.test(era),
  );
  check("real-data-era no longer reads the flag itself", !era.includes("showDemoData"));

  // Every surface that publishes an audited figure must honor hideAuditedZeros,
  // or turning the demo off leaves a "0 / 0.0 / 0%" row reading as a headline.
  for (const surface of [
    "components/MapPanel.tsx",
    "components/landing/PilotSection.tsx",
    "components/landing/Hero.tsx",
  ]) {
    check(
      `${surface} honors hideAuditedZeros`,
      code(surface).includes("hideAuditedZeros(stats, demoEnabled)"),
    );
  }
  check(
    "MapPanel has an empty state instead of zeroed figures",
    code("components/MapPanel.tsx").includes('t("auditedEmpty")'),
  );
}

console.log("");
console.log("the switch");
{
  const toggle = read("components/DemoDataToggle.tsx");
  check('toggle is a real switch, not a styled div', toggle.includes('role="switch"'));
  check("toggle is a <button> (keyboard operable by default)", toggle.includes("<button"));
  check("toggle exposes its state", toggle.includes("aria-checked={enabled}"));
  check("toggle has a visible focus ring", toggle.includes("focus-visible:ring-2"));
  check("toggle reads the provider, never the env", toggle.includes("useDemoData()") && !toggle.includes("showDemoData"));
  check("toggle calls the server action", toggle.includes("setDemoData("));
  check("toggle refreshes so both halves of the page move together", toggle.includes("router.refresh()"));

  const action = read("lib/demo-flag-actions.ts");
  check('action is a server function', action.trimStart().startsWith('"use server"'));
  check("cookie is path-scoped to /", /path:\s*"\/"/.test(action));
  check("cookie is SameSite=Lax", /sameSite:\s*"lax"/.test(action));
  check("cookie is long-lived", action.includes("DEMO_DATA_COOKIE_MAX_AGE"));
  check("action revalidates the layout that resolved the flag", action.includes("revalidatePath("));

  const chrome = read("components/MapChrome.tsx");
  check("switch is mounted in the always-on map chrome", chrome.includes("<DemoDataToggle"));

  const en = JSON.parse(read("messages/en.json"));
  const es = JSON.parse(read("messages/es.json"));
  check("EN switch label", typeof en.demoToggle?.label === "string" && en.demoToggle.label.length > 0);
  check("ES switch label", typeof es.demoToggle?.label === "string" && es.demoToggle.label.length > 0);
  check("EN and ES labels differ (ES is translated, not copied)", en.demoToggle.label !== es.demoToggle.label);
}

console.log("");
console.log("honesty strip survives the switch");
{
  const banner = code("components/DemoBanner.tsx");
  check(
    "banner has no dismiss control (no button, no click handler, no local state)",
    !/<button|onClick|useState/.test(banner),
  );
  check("banner is a status region", banner.includes('role="status"'));

  const mapPage = read("app/[locale]/map/page.tsx");
  check(
    "banner renders whenever the resolved era is on",
    mapPage.includes("{demoEnabled ? <DemoBanner /> : null}"),
  );
  check(
    "map page resolves the flag server-side",
    mapPage.includes("await demoDataEnabled()") && !mapPage.includes("showDemoData"),
  );
}

rmSync(BUILD_DIR, { recursive: true, force: true });

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — demo era defaults ON, flips at runtime, and stays honest");
