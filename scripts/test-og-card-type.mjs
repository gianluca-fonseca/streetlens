#!/usr/bin/env node
/**
 * test-og-card-type.mjs
 *
 * The typographic contract for the social cards. This suite exists because the
 * failure it catches is silent in both directions.
 *
 * Satori, which draws every `opengraph-image` route on this site, has no font
 * fallback chain and no access to a font book. A CSS family name it cannot
 * resolve is not a near miss: it falls all the way back to the one face bundled
 * with `next/og`, which is Geist REGULAR. So `fontFamily: "system-ui"` plus
 * `fontWeight: 700` produced a card that was neither the site's typeface nor
 * bold, on every route, and nothing anywhere reported it. The only way anyone
 * finds out is by looking at a link preview.
 *
 * What is locked:
 *
 *  1. THE FONT DATA EXISTS AND IS USABLE BY SATORI. Both vendored files parse as
 *     TrueType, are STATIC instances (satori renders a variable font's default
 *     instance and ignores the wght axis, and Space Grotesk's default instance
 *     is Light), and declare the weights they are named for.
 *  2. IT IS THE SITE'S TYPEFACE. The family in the font's own name table matches
 *     the family the app loads through `next/font/google`.
 *  3. EVERY RENDERER USES IT. No card file may set a CSS-name font family, and
 *     each one has to pass real font data to `ImageResponse`.
 *  4. THE BYTES REACH THE SERVERLESS BUNDLE. `next.config.ts` traces the font
 *     directory onto the card routes.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app", "[locale]");
const FONT_DIR = path.join(ROOT, "assets", "fonts");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(p, "utf8");

/**
 * Comments in these files quote the very anti-patterns this suite bans, because
 * that is how the reason for the ban survives. Scan code, not prose. Only block
 * comments and whole-line `//` comments are removed, which is enough here and
 * cannot swallow a `//` inside a string literal.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

/**
 * Just enough sfnt to answer the three questions that matter: which tables are
 * present, what the font calls itself, and what weight it claims. Deliberately
 * hand-rolled rather than pulled in as a dependency; the whole point of this
 * suite is that it runs everywhere `npm test` does.
 */
function parseFont(file) {
  const buf = readFileSync(file);
  const numTables = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString("ascii", rec, rec + 4).trim(), {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }

  const names = new Map();
  const nameTable = tables.get("name");
  if (nameTable) {
    const base = nameTable.offset;
    const count = buf.readUInt16BE(base + 2);
    const stringBase = base + buf.readUInt16BE(base + 4);
    for (let i = 0; i < count; i++) {
      const rec = base + 6 + i * 12;
      const platformId = buf.readUInt16BE(rec);
      const nameId = buf.readUInt16BE(rec + 6);
      const length = buf.readUInt16BE(rec + 8);
      const offset = buf.readUInt16BE(rec + 10);
      // Windows records are UTF-16BE, Macintosh ones a single byte per char.
      // Either answers the question, so take whichever appears first.
      if (names.has(nameId)) continue;
      const bytes = Buffer.from(buf.subarray(stringBase + offset, stringBase + offset + length));
      if (platformId === 3) bytes.swap16(); // UTF-16BE to the LE Node decodes
      names.set(nameId, bytes.toString(platformId === 3 ? "utf16le" : "latin1"));
    }
  }

  const os2 = tables.get("OS/2");
  return {
    sfntVersion: buf.readUInt32BE(0),
    tables,
    family: names.get(1),
    subfamily: names.get(2),
    weightClass: os2 ? buf.readUInt16BE(os2.offset + 4) : undefined,
  };
}

console.log("Font data");

const EXPECTED = [
  { file: "SpaceGrotesk-Regular.ttf", subfamily: "Regular", weight: 400 },
  { file: "SpaceGrotesk-Bold.ttf", subfamily: "Bold", weight: 700 },
];

check("the vendored font directory exists", existsSync(FONT_DIR), FONT_DIR);

// OFL requires the licence to travel with the font.
check(
  "the OFL travels with the font data",
  existsSync(path.join(FONT_DIR, "OFL.txt")),
  "assets/fonts/OFL.txt",
);

let cardFamily;
for (const expected of EXPECTED) {
  const file = path.join(FONT_DIR, expected.file);
  if (!existsSync(file)) {
    check(`${expected.file} exists`, false);
    continue;
  }
  const font = parseFont(file);

  // 0x00010000 is TrueType outlines, "OTTO" (0x4f54544f) is CFF. Satori accepts
  // both; it does NOT accept woff2, which is what `next/font` emits.
  check(
    `${expected.file} is a TrueType or OpenType file, not woff2`,
    font.sfntVersion === 0x00010000 || font.sfntVersion === 0x4f54544f,
    `sfntVersion 0x${font.sfntVersion.toString(16)}`,
  );

  // The load-bearing one. Satori renders a variable font's DEFAULT instance and
  // never applies the wght axis, and Space Grotesk's default instance is Light,
  // so shipping the variable file would make the card lighter than the bug it
  // replaced rather than bolder.
  check(
    `${expected.file} is a static instance, not a variable font`,
    !font.tables.has("fvar"),
    font.tables.has("fvar") ? "has an fvar table" : "no fvar table",
  );

  check(
    `${expected.file} declares weight ${expected.weight}`,
    font.weightClass === expected.weight,
    `usWeightClass ${font.weightClass}, subfamily "${font.subfamily}"`,
  );

  cardFamily ??= font.family;
  check(
    `${expected.file} belongs to the same family as its sibling`,
    font.family === cardFamily,
    `"${font.family}"`,
  );
}

// A card font is loaded on every card render. A stray 5 MB face with every
// script in Unicode would be a build-time and bundle-size regression nobody
// would notice from looking at the card.
const fontBytes = readdirSync(FONT_DIR)
  .filter((f) => f.endsWith(".ttf") || f.endsWith(".otf"))
  .reduce((sum, f) => sum + statSync(path.join(FONT_DIR, f)).size, 0);
check(
  "the vendored font data stays under 400 KB in total",
  fontBytes > 0 && fontBytes < 400 * 1024,
  `${Math.round(fontBytes / 1024)} KB`,
);

console.log("\nThe family matches the site");

const layout = read(path.join(APP, "layout.tsx"));
const declared = layout.match(/import\s*\{([^}]*)\}\s*from\s*"next\/font\/google"/);
const siteFamily = declared
  ? declared[1]
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.replace(/_/g, " ") === cardFamily)
  : undefined;
check(
  "the card's font family is one the app loads through next/font/google",
  Boolean(siteFamily),
  `card "${cardFamily}", layout imports ${declared ? declared[1].trim() : "nothing"}`,
);

const brand = read(path.join(ROOT, "lib", "og-brand.tsx"));
check(
  "og-brand names the same family it vendors",
  new RegExp(`BRAND_FONT_FAMILY\\s*=\\s*"${cardFamily}"`).test(brand),
  `BRAND_FONT_FAMILY = "${cardFamily}"`,
);

console.log("\nEvery card renderer draws with it");

/** Every file that renders an OG image, found rather than listed. */
function cardFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cardFiles(full));
    else if (/^opengraph-image\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const renderers = [...cardFiles(APP), path.join(ROOT, "lib", "og-brand.tsx")];
check("card renderers were found to check", renderers.length >= 10, `${renderers.length} files`);

for (const file of renderers) {
  const source = stripComments(read(file));
  const rel = path.relative(ROOT, file);
  const responses = (source.match(/new ImageResponse\(/g) ?? []).length;
  if (responses === 0) {
    // A route file that delegates to og-brand. It must not set its own family.
    check(
      `${rel} sets no font family of its own`,
      !/fontFamily:/.test(source),
      "delegates to lib/og-brand",
    );
    continue;
  }

  check(
    `${rel} sets no CSS-name font family satori cannot resolve`,
    !/fontFamily:\s*"[^"]*(system-ui|sans-serif|serif|monospace)/.test(source),
    `${responses} ImageResponse call(s)`,
  );
  check(
    `${rel} passes real font data to all ${responses} ImageResponse call(s)`,
    (source.match(/\{\s*\.\.\.\w+(?:\w|\.)*,\s*fonts\s*\}/g) ?? []).length === responses,
  );
  check(
    `${rel} loads the shared font data rather than its own`,
    /loadBrandFonts\(\)/.test(source),
  );
}

console.log("\nThe bytes reach the bundle");

const config = read(path.join(ROOT, "next.config.ts"));
check(
  "next.config traces the font directory onto the card routes",
  /outputFileTracingIncludes/.test(config) && /assets\/fonts\/\*\.ttf/.test(config),
);

console.log(
  failures.length === 0
    ? "\nOG CARD TYPE: OK"
    : `\nOG CARD TYPE: ${failures.length} FAILURE(S)\n${failures.map((f) => `  - ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
