#!/usr/bin/env node
/**
 * test-canonical-observation.mjs (u32, issue #19)
 *
 * Locks the rule that ONE approved camera observation is the segment's present
 * state: the most recently WALKED one. Before this, lib/segments.ts read
 * community_cv_observations with no ordering and SegmentDetail rendered every
 * row as an equal peer, so approving a fresh walk added a card next to the
 * stale one instead of updating what the street "is" (the #19 defect).
 *
 * What must hold, and why each case is here rather than being obvious:
 *  - captured_on (the walk) outranks created_at (the approval). An old walk
 *    approved yesterday must NOT displace a recent walk approved last month.
 *  - ties fall through deterministically, so two identical-dated observations
 *    cannot swap places between renders depending on PostgREST row order.
 *  - junk dates LOSE. These values cross the maplibre property boundary; a
 *    malformed field must never float an observation to the top.
 *  - the split is exhaustive: canonical is excluded from the archive and every
 *    other observation is in it, so the disclosure can never silently drop a
 *    reading.
 *  - zero or one observation yields an EMPTY archive, which is what lets the
 *    panel render no toggle at all rather than an empty-archive stub.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const { canonicalCvObservation, splitCvObservations } = await import(
  path.join(ROOT, "lib/cv-provenance.ts")
);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** A minimal observation carrying only the fields the ordering reads. */
const obs = (id, captured_on, created_at = "2026-01-01T00:00:00Z") => ({
  id,
  captured_on,
  created_at,
});

console.log("\ncanonical selection — latest walk wins");
{
  const older = obs("a", "2026-03-01T00:00:00Z");
  const newer = obs("b", "2026-06-01T00:00:00Z");
  check(
    "latest captured_on is canonical",
    canonicalCvObservation([older, newer])?.id === "b",
  );
  check(
    "input order does not matter",
    canonicalCvObservation([newer, older])?.id === "b",
  );
}
{
  // The heart of the mandate: the walk date is the street's present-day state,
  // approval time is just when an admin got around to it.
  const staleWalkFreshApproval = obs(
    "a",
    "2025-01-01T00:00:00Z",
    "2026-07-01T00:00:00Z",
  );
  const freshWalkStaleApproval = obs(
    "b",
    "2026-06-01T00:00:00Z",
    "2026-06-02T00:00:00Z",
  );
  check(
    "captured_on outranks created_at (recent walk beats recent approval)",
    canonicalCvObservation([staleWalkFreshApproval, freshWalkStaleApproval])
      ?.id === "b",
  );
}

console.log("\ntie-breaks — deterministic, never render-order dependent");
{
  const a = obs("a", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");
  const b = obs("b", "2026-06-01T00:00:00Z", "2026-06-09T00:00:00Z");
  check(
    "same captured_on → latest created_at wins",
    canonicalCvObservation([a, b])?.id === "b",
  );
}
{
  const a = obs("aaa", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");
  const b = obs("bbb", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");
  check(
    "fully tied → id tie-break is stable across input orders",
    canonicalCvObservation([a, b])?.id === canonicalCvObservation([b, a])?.id,
  );
}

console.log("\nhostile input — junk must lose, never throw");
{
  const junk = obs("a", "not-a-date", "also-not-a-date");
  const real = obs("b", "2026-06-01T00:00:00Z");
  check(
    "unparseable captured_on loses to a real one",
    canonicalCvObservation([junk, real])?.id === "b",
  );
  check("null captured_on loses to a real one", canonicalCvObservation([obs("a", null), real])?.id === "b");
  check(
    "all-junk list still returns a deterministic pick, not null",
    canonicalCvObservation([junk, obs("c", "nope", "nope")])?.id === "a",
  );
  check("empty list → null", canonicalCvObservation([]) === null);
  check("null input → null", canonicalCvObservation(null) === null);
  check("non-array input → null", canonicalCvObservation("garbage") === null);
  check(
    "entries without a string id are skipped",
    canonicalCvObservation([null, { captured_on: "2026-09-01T00:00:00Z" }, real])
      ?.id === "b",
  );
}

console.log("\narchive split — exhaustive, canonical excluded");
{
  const a = obs("a", "2026-01-01T00:00:00Z");
  const b = obs("b", "2026-06-01T00:00:00Z");
  const c = obs("c", "2026-03-01T00:00:00Z");
  const { canonical, archived } = splitCvObservations([a, b, c]);
  check("canonical is the latest walk", canonical?.id === "b");
  check(
    "archive holds every non-canonical observation",
    archived.length === 2,
    `(${archived.length})`,
  );
  check(
    "canonical is NOT in the archive",
    !archived.some((o) => o.id === "b"),
  );
  check(
    "archive is newest-first",
    archived.map((o) => o.id).join(",") === "c,a",
    `(${archived.map((o) => o.id).join(",")})`,
  );
  check(
    "nothing is dropped — canonical + archive covers the input",
    new Set([canonical.id, ...archived.map((o) => o.id)]).size === 3,
  );
}

console.log("\nno-toggle cases — zero or one observation");
{
  const only = obs("a", "2026-06-01T00:00:00Z");
  const one = splitCvObservations([only]);
  check("single observation is canonical", one.canonical?.id === "a");
  check(
    "single observation → EMPTY archive (panel renders no toggle)",
    one.archived.length === 0,
  );
  const none = splitCvObservations([]);
  check("empty list → null canonical", none.canonical === null);
  check("empty list → empty archive", none.archived.length === 0);
  const nullish = splitCvObservations(null);
  check("null input → null canonical, empty archive", nullish.canonical === null && nullish.archived.length === 0);
}

console.log(
  `\n${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`} — canonical observation\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
