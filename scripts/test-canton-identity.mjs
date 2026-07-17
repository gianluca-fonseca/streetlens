#!/usr/bin/env node
/**
 * test-canton-identity.mjs (bgsd-0003 canton network expansion)
 *
 * The San Antonio pilot (esc-sa-*) is the audited ground truth. Expanding the
 * network to the whole canton must NEVER silently mutate it: a regenerated
 * data/segments.geojson has to reproduce the pilot's 535 features byte-for-byte,
 * in the same order, with the same ids.
 *
 * This test freezes that promise against scripts/fixtures/esc-sa-frozen.json
 * (the pilot's ordered id list + a content hash of its feature array). If a
 * re-import ever shifts an id, drops a segment, or nudges a coordinate, the hash
 * moves and this test fails loudly. Changing the pilot is then a deliberate act:
 * regenerate the fixture on purpose, never by accident.
 *
 * It also sanity-checks the new districts: esc-ce-* / esc-sr-* exist, carry the
 * right district_id, and never collide with the pilot id space.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  const segments = JSON.parse(
    readFileSync(path.join(ROOT, "data", "segments.geojson"), "utf8"),
  );
  const frozen = JSON.parse(
    readFileSync(path.join(ROOT, "scripts", "fixtures", "esc-sa-frozen.json"), "utf8"),
  );

  const features = segments.features;
  const pilot = features.filter((f) => f.properties.id.startsWith("esc-sa-"));

  console.log("\n1. pilot (esc-sa-*) is frozen");
  check(
    `pilot segment count is ${frozen.count}`,
    pilot.length === frozen.count,
    `got ${pilot.length}`,
  );

  const ids = pilot.map((f) => f.properties.id);
  const idsMatch =
    ids.length === frozen.ids.length &&
    ids.every((id, i) => id === frozen.ids[i]);
  check("pilot ids match the frozen list exactly, in order", idsMatch);

  const hash = createHash("sha256").update(JSON.stringify(pilot)).digest("hex");
  check(
    "pilot feature content hash is unchanged",
    hash === frozen.sha256,
    hash === frozen.sha256 ? "" : `got ${hash}, expected ${frozen.sha256}`,
  );

  // The pilot must also stay at the FRONT of the collection, in order, so the
  // demo generator's pilot slice and every downstream index stay stable.
  const firstN = features.slice(0, frozen.count);
  check(
    "the first 535 features are exactly the pilot, in order",
    firstN.length === frozen.count &&
      firstN.every((f, i) => f.properties.id === frozen.ids[i]),
  );

  console.log("\n2. new districts exist and never collide with the pilot");
  const centro = features.filter((f) => f.properties.id.startsWith("esc-ce-"));
  const rafael = features.filter((f) => f.properties.id.startsWith("esc-sr-"));
  check("Escazú centro (esc-ce-*) has segments", centro.length > 0, `${centro.length}`);
  check("San Rafael (esc-sr-*) has segments", rafael.length > 0, `${rafael.length}`);
  check(
    "esc-ce-* all carry district_id esc-escazu",
    centro.every((f) => f.properties.district_id === "esc-escazu"),
  );
  check(
    "esc-sr-* all carry district_id esc-san-rafael",
    rafael.every((f) => f.properties.district_id === "esc-san-rafael"),
  );
  check(
    "every canton feature keeps canton_id esc",
    features.every((f) => f.properties.canton_id === "esc"),
  );

  const uniqueIds = new Set(features.map((f) => f.properties.id));
  check(
    "no duplicate segment ids across the whole canton",
    uniqueIds.size === features.length,
    `${uniqueIds.size} unique of ${features.length}`,
  );

  console.log(
    `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length} failing check(s)` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
