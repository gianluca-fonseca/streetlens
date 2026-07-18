#!/usr/bin/env node
/**
 * test-i18n-parity.mjs (u1 frame lightbox, and every locale string besides)
 *
 * The one invariant a translated UI cannot violate: EN and ES must expose the
 * EXACT same set of message keys. A key present in one and missing in the other
 * is a runtime hole — next-intl throws (or renders the raw key) the moment a
 * component asks for the absent side, and it will only ever be the locale nobody
 * on the team reads that breaks. This asserts full structural parity, so any new
 * string (the lightbox's included) is caught the instant it lands on one side
 * only.
 *
 * Leaf-level: it also flags a key that is an object on one side and a string on
 * the other, which would slip past a shallow key-set diff.
 *
 * Exits 0 on PASS, 1 on any mismatch.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MESSAGES = path.join(ROOT, "messages");

/** Flatten to dotted leaf paths; a leaf is any non-object (string/number/array). */
function leaves(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, key, out);
    else out.set(key, typeof v);
  }
  return out;
}

function load(locale) {
  return JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
}

const en = leaves(load("en"));
const es = leaves(load("es"));

const onlyEn = [...en.keys()].filter((k) => !es.has(k));
const onlyEs = [...es.keys()].filter((k) => !en.has(k));
const typeMismatch = [...en.keys()].filter((k) => es.has(k) && en.get(k) !== es.get(k));

console.log(`en leaf keys: ${en.size}`);
console.log(`es leaf keys: ${es.size}`);
console.log(`only in en: ${onlyEn.length} ${JSON.stringify(onlyEn.slice(0, 20))}`);
console.log(`only in es: ${onlyEs.length} ${JSON.stringify(onlyEs.slice(0, 20))}`);
console.log(`leaf-type mismatch: ${typeMismatch.length} ${JSON.stringify(typeMismatch.slice(0, 20))}`);

// The lightbox's own strings must exist on BOTH sides — an explicit guard so this
// unit's contract is checked by name, not only by aggregate count.
const REQUIRED = [
  "admin.capture.enlargeFrame",
  "admin.capture.lightboxTitle",
  "admin.capture.lightboxClose",
  "admin.capture.lightboxPrev",
  "admin.capture.lightboxNext",
  "admin.capture.lightboxCounter",
  "admin.capture.rationaleMore",
  "admin.capture.rationaleLess",
];
const missingRequired = REQUIRED.filter((k) => !en.has(k) || !es.has(k));
console.log(`lightbox keys present both sides: ${REQUIRED.length - missingRequired.length}/${REQUIRED.length} ${JSON.stringify(missingRequired)}`);

const ok =
  onlyEn.length === 0 &&
  onlyEs.length === 0 &&
  typeMismatch.length === 0 &&
  missingRequired.length === 0;

if (!ok) {
  console.log("\nPARITY: FAIL");
  process.exit(1);
}
console.log("\nPARITY: OK (identical key sets)");
