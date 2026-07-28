#!/usr/bin/env node
/**
 * test-field-notes.mjs — the crew's field notes reach the UI, in the viewer's
 * language, attached to the answer they explain.
 *
 * Everything here is asserted by RUNNING the shipped code, never by scanning it
 * for a substring:
 *
 *   1. RESOLUTION. lib/field-notes.ts is compiled and driven. Spanish takes
 *      `note`, English takes `note_en`, and each falls back to the other side
 *      rather than to a hole.
 *   2. RENDER. components/FieldNote.tsx is rendered for real with
 *      react-dom/server. A note produces markup containing the note; no note
 *      produces the empty string, so an item without one grows no container.
 *   3. COUNT. lib/segments.ts's real getSegmentDetail is compiled and called,
 *      and the notes that survive the resolve for a known segment are counted
 *      against data/demo-audits.json directly. If the read path ever drops
 *      `note_en`, or the resolver ever silently discards an observation, the
 *      two numbers diverge.
 *   4. DEMO GATE. The panel renders no breakdown, and therefore no note, when
 *      the demo era is off. Both halves are exercised live: getSegments(false)
 *      is called to see how it recasts an audited segment, and the resulting
 *      properties are fed to a real render of components/SegmentDetail.tsx.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-field-notes");
const TSCONFIG = path.join(ROOT, "tsconfig.field-notes-test.json");
const require = createRequire(import.meta.url);

/*
 * The generated tsconfig has to sit at the repo root for the base config's
 * `@/*` paths to resolve, and the root is where a stray file would show up as
 * an uncommitted edit. Clean up on ANY exit, including a throw, so a failing
 * run never leaves the tree dirty for the next gate.
 */
process.on("exit", () => {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(TSCONFIG, { force: true });
});

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/* ------------------------------------------------------------------ *
 * Compile the real modules to CJS so plain Node can run them.
 * ------------------------------------------------------------------ */

/**
 * `*.module.css` is declared by next-env.d.ts, which `next build` generates and
 * git does not track — so this harness cannot rely on it being on disk. Declare
 * the one shape needed here instead.
 */
const CSS_SHIM = path.join(BUILD_DIR, "css-modules.d.ts");

const ENTRYPOINTS = [
  path.relative(ROOT, CSS_SHIM),
  // next-intl's typed message catalogue.
  "global.d.ts",
  "lib/field-notes.ts",
  "lib/segments.ts",
  "components/FieldNote.tsx",
  "components/SegmentDetail.tsx",
];

function compile() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(
    CSS_SHIM,
    'declare module "*.module.css" {\n' +
      "  const classes: { readonly [key: string]: string };\n" +
      "  export default classes;\n" +
      "}\n",
  );
  writeFileSync(
    TSCONFIG,
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          noEmit: false,
          outDir: path.relative(ROOT, BUILD_DIR),
          rootDir: ".",
          module: "commonjs",
          moduleResolution: "node",
          isolatedModules: false,
          incremental: false,
          jsx: "react-jsx",
        },
        // `files` alone, with the base config's whole-tree `include` cleared:
        // compiling every .ts in the repo would drag in the capture engine,
        // whose deps only resolve under `moduleResolution: bundler`.
        include: [],
        exclude: ["node_modules"],
        files: ENTRYPOINTS,
      },
      null,
      2,
    ),
  );
  execFileSync("npx", ["tsc", "-p", path.relative(ROOT, TSCONFIG)], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

compile();

/*
 * tsc does not rewrite the `@/…` path alias in its output, and it emits a bare
 * `require()` for the CSS modules. Two hooks bridge that: aliases resolve into
 * the build dir, a stylesheet resolves to its real source path and loads as a
 * class-name proxy, and `@/i18n/navigation` resolves to a stub because
 * next-intl's navigation helpers need a Next request context that no plain-Node
 * render can supply (the panel's share button is not what is under test here).
 */
const STUB_DIR = path.join(BUILD_DIR, "__stubs");
const NAV_STUB = path.join(STUB_DIR, "navigation.js");
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(
  NAV_STUB,
  [
    'const React = require("react");',
    "exports.Link = function Link(props) {",
    '  const { href, children, ...rest } = props;',
    '  return React.createElement("a", { href: String(href), ...rest }, children);',
    "};",
    "exports.redirect = () => {};",
    "exports.usePathname = () => \"/\";",
    "exports.useRouter = () => ({ push: () => {}, replace: () => {} });",
    "exports.getPathname = () => \"/\";",
  ].join("\n"),
);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const rel = request.slice(2);
    if (rel === "i18n/navigation") return NAV_STUB;
    if (rel.endsWith(".css")) return path.join(ROOT, rel);
    return originalResolve.call(this, path.join(BUILD_DIR, rel), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

// A CSS module loads as "every property is its own class name", which is all a
// server render needs: the markup carries the class, the styling does not.
Module._extensions[".css"] = function (mod) {
  mod.exports = new Proxy(
    {},
    { get: (_target, key) => (typeof key === "string" ? key : undefined) },
  );
};

const fieldNotes = require(path.join(BUILD_DIR, "lib", "field-notes.js"));
const segments = require(path.join(BUILD_DIR, "lib", "segments.js"));
const FieldNote = require(path.join(BUILD_DIR, "components", "FieldNote.js")).default;
const SegmentDetail = require(
  path.join(BUILD_DIR, "components", "SegmentDetail.js"),
).default;

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { NextIntlClientProvider } = require("next-intl");

const AUDITS = JSON.parse(
  readFileSync(path.join(ROOT, "data", "demo-audits.json"), "utf8"),
);
const enMessages = JSON.parse(
  readFileSync(path.join(ROOT, "messages", "en.json"), "utf8"),
);
const esMessages = JSON.parse(
  readFileSync(path.join(ROOT, "messages", "es.json"), "utf8"),
);

/* ------------------------------------------------------------------ *
 * 1. Locale resolution, including both fallback directions.
 * ------------------------------------------------------------------ */

console.log("locale resolution");
{
  const es = "El concreto está levantado por raíces.";
  const en = "Roots have lifted the concrete.";

  check(
    "es locale takes the Spanish note",
    fieldNotes.fieldNoteForLocale(es, en, "es") === es,
  );
  check(
    "en locale takes the English note",
    fieldNotes.fieldNoteForLocale(es, en, "en") === en,
  );
  check(
    "es falls back to English when the Spanish note is missing",
    fieldNotes.fieldNoteForLocale(null, en, "es") === en,
  );
  check(
    "en falls back to Spanish when the English note is missing",
    fieldNotes.fieldNoteForLocale(es, null, "en") === es,
  );
  check(
    "no note either side stays null",
    fieldNotes.fieldNoteForLocale(null, null, "en") === null &&
      fieldNotes.fieldNoteForLocale(null, null, "es") === null,
  );
  check(
    "a blank note is the same as no note (never an empty affordance)",
    fieldNotes.fieldNoteForLocale("   ", "", "es") === null,
  );
  check(
    "a blank preferred side falls through to the other one",
    fieldNotes.fieldNoteForLocale("  ", en, "es") === en,
  );
  check(
    "malformed input degrades to null rather than throwing",
    fieldNotes.fieldNoteForLocale({ note: es }, 42, "es") === null,
  );

  // The same rule governs the label the note hangs under, or a Spanish note
  // could end up sitting beneath an English item name.
  check(
    "labels resolve on the same terms as notes",
    fieldNotes.rubricLabelForLocale("Curb ramp", "Rampa en el cruce", "es") ===
      "Rampa en el cruce" &&
      fieldNotes.rubricLabelForLocale("Curb ramp", "Rampa en el cruce", "en") ===
        "Curb ramp",
  );

  // A resolved observation must never mix languages across its two fields.
  const mixed = fieldNotes.toFieldObservations(
    [
      {
        item_key: "surface_condition",
        label_en: "Sidewalk surface condition",
        label_es: "Estado de la superficie de la acera",
        layer: "accessibility",
        response: 0.25,
        note: es,
        note_en: en,
      },
    ],
    "es",
  );
  check(
    "es resolves label and note together, and shows only one language",
    mixed.length === 1 &&
      mixed[0].label === "Estado de la superficie de la acera" &&
      mixed[0].note === es &&
      !mixed[0].note.includes(en),
  );
  check(
    "a 0..1 response becomes a whole 0-100 figure",
    mixed[0].score === 25,
  );
  check(
    "junk in the observation array is dropped, not rendered unlabelled",
    fieldNotes.toFieldObservations(
      [null, 7, {}, { layer: "accessibility", note: "x" }],
      "en",
    ).length === 0,
  );
}

/* ------------------------------------------------------------------ *
 * 2. FieldNote renders a note, and renders NOTHING without one.
 * ------------------------------------------------------------------ */

console.log("");
console.log("FieldNote render");
{
  const note = "Roots have lifted the concrete and it catches your foot.";
  const withNote = renderToStaticMarkup(
    React.createElement(FieldNote, { label: "Field note · Equipo StreetLens B", note }),
  );
  const withoutNote = renderToStaticMarkup(
    React.createElement(FieldNote, { label: "Field note", note: null }),
  );

  check("an observation with a note renders it", withNote.includes(note));
  check(
    "and renders the crew attribution alongside it",
    withNote.includes("Equipo StreetLens B"),
  );
  check(
    "an observation without a note renders no container at all",
    withoutNote === "",
    JSON.stringify(withoutNote),
  );
  check(
    "an empty-string note renders no container either",
    renderToStaticMarkup(
      React.createElement(FieldNote, { label: "Field note", note: "" }),
    ) === "",
  );

  // Honesty: simulated prose must not be dressed as a person being quoted.
  check(
    "the note is not framed as a human quotation",
    !/<(blockquote|cite|q)\b/.test(withNote) && !withNote.includes("&quot;"),
  );
}

/* ------------------------------------------------------------------ *
 * 3. Count parity through the real read path.
 * ------------------------------------------------------------------ */

console.log("");
console.log("count parity with data/demo-audits.json");

const SEGMENT_WITH_NOTES = "esc-sa-0136";
const SEGMENT_WITHOUT_NOTES = "esc-sa-0056";

function rawNoteCount(segmentId, field) {
  const audit = AUDITS.audits[segmentId];
  if (!audit) return -1;
  return audit.observations.filter((o) => {
    const v = o[field];
    return typeof v === "string" && v.trim().length > 0;
  }).length;
}

{
  const detail = await segments.getSegmentDetail(SEGMENT_WITH_NOTES);
  check(
    `${SEGMENT_WITH_NOTES} resolves to an audit`,
    Boolean(detail && detail.audit),
  );

  for (const [locale, field] of [
    ["es", "note"],
    ["en", "note_en"],
  ]) {
    const resolved = fieldNotes.toFieldObservations(
      detail.audit.observations,
      locale,
    );
    const rendered = resolved.filter((o) => o.note !== null).length;
    const raw = rawNoteCount(SEGMENT_WITH_NOTES, field);
    check(
      `${locale}: notes reaching the UI match the data file`,
      rendered === raw && raw > 0,
      `(ui ${rendered}, file ${raw})`,
    );
    check(
      `${locale}: every observation survives the resolve`,
      resolved.length === AUDITS.audits[SEGMENT_WITH_NOTES].observations.length,
      `(${resolved.length}/${AUDITS.audits[SEGMENT_WITH_NOTES].observations.length})`,
    );
    // The note the UI shows must be the one the file holds for that locale.
    const first = resolved.find((o) => o.note !== null);
    const source = AUDITS.audits[SEGMENT_WITH_NOTES].observations.find(
      (o) => o.item_key === first.item_key,
    );
    check(
      `${locale}: the note shown is the ${field} the file holds`,
      first.note === source[field],
    );
  }

  const empty = await segments.getSegmentDetail(SEGMENT_WITHOUT_NOTES);
  const emptyResolved = fieldNotes.toFieldObservations(
    empty.audit.observations,
    "en",
  );
  check(
    `${SEGMENT_WITHOUT_NOTES} has observations but no notes at all`,
    emptyResolved.length > 0 &&
      emptyResolved.every((o) => o.note === null) &&
      rawNoteCount(SEGMENT_WITHOUT_NOTES, "note") === 0,
    `(${emptyResolved.length} observations, 0 notes)`,
  );

  // Whole-corpus parity, so a read-path change cannot lose notes in bulk while
  // one hand-picked segment still passes.
  let uiTotalEs = 0;
  let uiTotalEn = 0;
  let fileTotalEs = 0;
  let fileTotalEn = 0;
  for (const id of Object.keys(AUDITS.audits)) {
    const obs = AUDITS.audits[id].observations;
    uiTotalEs += fieldNotes
      .toFieldObservations(obs, "es")
      .filter((o) => o.note !== null).length;
    uiTotalEn += fieldNotes
      .toFieldObservations(obs, "en")
      .filter((o) => o.note !== null).length;
    fileTotalEs += rawNoteCount(id, "note");
    fileTotalEn += rawNoteCount(id, "note_en");
  }
  check(
    "every Spanish note in the corpus reaches the UI",
    uiTotalEs === fileTotalEs && fileTotalEs > 0,
    `(${uiTotalEs}/${fileTotalEs})`,
  );
  check(
    "every English note in the corpus reaches the UI",
    uiTotalEn === fileTotalEn && fileTotalEn > 0,
    `(${uiTotalEn}/${fileTotalEn})`,
  );
}

/* ------------------------------------------------------------------ *
 * 4. Demo era off: no breakdown, so no note.
 * ------------------------------------------------------------------ */

console.log("");
console.log("demo era off publishes no notes");

function renderPanel(properties, locale) {
  return renderToStaticMarkup(
    React.createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: locale === "es" ? esMessages : enMessages,
        // The panel is rendered outside a request, so next-intl's time-zone and
        // now() defaults have nothing to read; pin them rather than warn.
        timeZone: "America/Costa_Rica",
        now: new Date("2026-07-28T00:00:00Z"),
      },
      React.createElement(SegmentDetail, {
        segment: properties,
        activeLayer: "accessibility",
        onClose: () => {},
      }),
    ),
  );
}

{
  const findProps = (collection, id) => {
    const f = collection.features.find((x) => x.properties.id === id);
    return f ? f.properties : null;
  };

  const on = findProps(await segments.getSegments(true), SEGMENT_WITH_NOTES);
  const off = findProps(await segments.getSegments(false), SEGMENT_WITH_NOTES);

  check("the segment is on the map in both eras", Boolean(on && off));
  check(
    "demo era ON publishes the segment as audited",
    on.source === undefined && on.score_overall > 0,
    `(source ${String(on.source)}, overall ${on.score_overall})`,
  );
  check(
    "demo era OFF recasts it as an unaudited import with no scores",
    off.source === "import" && off.score_overall === 0,
    `(source ${String(off.source)}, overall ${off.score_overall})`,
  );

  const breakdownEn = enMessages.detail.breakdownHeading;
  const noteLabelEn = enMessages.detail.fieldNoteLabel;

  const panelOn = renderPanel(on, "en");
  const panelOff = renderPanel(off, "en");

  check(
    "demo era ON renders the rubric breakdown the notes live in",
    panelOn.includes(breakdownEn),
  );
  check(
    "demo era OFF renders no rubric breakdown, so no note can appear",
    !panelOff.includes(breakdownEn) && !panelOff.includes(noteLabelEn),
  );
  check(
    "demo era OFF says so instead, with the community/unaudited note",
    panelOff.includes(enMessages.detail.communityNote),
  );

  // Spanish renders the Spanish chrome, on the same gate.
  const panelEs = renderPanel(on, "es");
  check(
    "the es panel renders the Spanish breakdown heading",
    panelEs.includes(esMessages.detail.breakdownHeading),
  );
  check(
    "no note leaks into the first paint before the audit fetch resolves",
    !panelOn.includes(noteLabelEn),
    "the click-time fetch supplies the audit; the pre-fetch paint carries no prose",
  );
}

console.log("");
if (failures.length) {
  console.error(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log(
  "PASS — notes resolve per locale, attach to their answer, render nothing when absent, and stay off the map when the demo era is off.",
);
