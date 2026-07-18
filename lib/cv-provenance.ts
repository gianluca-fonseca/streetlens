/**
 * cv-provenance — pure formatting for the provenance facts a CV observation
 * carries: when the street was walked, when the observation was last updated
 * (approved/re-approved), and who submitted it.
 *
 * Deliberately dependency-light (Intl only, no React/next imports) so it compiles
 * standalone and is unit-testable the same way lib/parse-feature-props.ts is
 * (scripts/test-cv-provenance.mjs drives the CJS build directly).
 *
 * Every input crosses the maplibre property boundary (see lib/parse-feature-props.ts),
 * so each helper tolerates junk and NEVER throws: a bad date reads as "no date", a
 * non-string contact reads as "no contact" (the caller shows "Anonymous contributor").
 */

/**
 * An ISO timestamp as a friendly localized date, or null when absent/unparseable.
 *
 * `timeZone: "UTC"` is load-bearing: `captured_on`/`created_at` are stored as UTC
 * instants, and pinning the zone makes the rendered calendar day stable regardless
 * of the machine's local zone (a test running in America/Costa_Rica and one in UTC
 * must print the same day). Day-granularity only: provenance is a date, not a clock.
 */
export function formatProvenanceDate(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (typeof iso !== "string") return null;
  const s = iso.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * A contributor contact sanitized for display, or null when there is none.
 *
 * Shown as given (it may be an email), never linkified — no mailto, so a click can
 * never exfiltrate the address into a mail client from the public map. Whitespace is
 * collapsed and the string is capped so a hostile or accidental mega-value cannot
 * blow out the compact popover line. When this returns null the caller renders the
 * localized "Anonymous contributor" fallback; the ip hash is NEVER passed here.
 */
export function sanitizeContact(contact: unknown): string | null {
  if (typeof contact !== "string") return null;
  const s = contact.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/** Below this, a real percentage is shown as a floor rather than rounded away. */
const COVERAGE_FLOOR_PCT = 0.1;

/**
 * `StreetStats.cvCoveragePct` as a display string, or null when there is nothing
 * to show (zero, negative, or not a number — the caller then renders no
 * percentage fragment at all rather than an honest-looking "0%").
 *
 * THE RULE THIS EXISTS FOR: never print "0.0%" for a value that is genuinely
 * above zero. A single approved street is ~0.09% of the canton network, so naive
 * one-decimal rounding would render "0.0%" — indistinguishable from the "nothing
 * happened" the owner reported as breakage, on the very number that is supposed
 * to move when an approval lands. Anything under 0.1% floors to "<0.1%" instead,
 * which is both truthful and visibly non-zero.
 *
 * Locale-aware: Spanish takes a comma decimal separator ("2,3%", "<0,1%"), so the
 * threshold is formatted through Intl too rather than hardcoded into the string.
 */
export function formatCvCoveragePct(
  pct: unknown,
  locale: string,
): string | null {
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) return null;
  const format = (n: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(n);
  return pct < COVERAGE_FLOOR_PCT
    ? `<${format(COVERAGE_FLOOR_PCT)}%`
    : `${format(pct)}%`;
}

/* ------------------------------------------------------------------ *
 * Canonical observation selection (u32, issue #19)
 *
 * A segment can accumulate several approved camera observations over time.
 * Before this, the detail panel rendered all of them as equal peers, so an
 * approval that was supposed to update the street's state instead just added
 * another card next to the stale one, and nothing on the page said which
 * reading actually describes the street today.
 *
 * The rule: ONE observation is canonical and it is the most recently WALKED
 * one. The walk date is what represents the present-day street; approval time
 * only says when an admin got to it. Everything else is archive.
 *
 * This lives here, once, as a pure function. Components must never re-sort
 * observations themselves — a second ordering somewhere else is exactly how
 * two surfaces start disagreeing about what the segment is.
 * ------------------------------------------------------------------ */

/**
 * The provenance fields the canonical ordering reads. Structurally a subset of
 * {@link import("./types").CvObservation}, so a real observation satisfies it,
 * but stated locally to keep this module dependency-light and to let tests
 * drive it with minimal fixtures.
 */
export type CvOrderable = {
  id: string;
  captured_on?: string | null;
  created_at?: string | null;
};

/**
 * An ISO timestamp as a sortable epoch, or -Infinity when absent/unparseable.
 *
 * -Infinity rather than 0 or NaN is deliberate: these values cross the maplibre
 * property boundary, and an observation whose date is junk must LOSE to any
 * observation that carries a real one. It must never sort to the top and claim
 * to be the present-day state of the street on the strength of a bad field.
 */
function sortableTime(iso: string | null | undefined): number {
  if (typeof iso !== "string") return -Infinity;
  const s = iso.trim();
  if (!s) return -Infinity;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Newest-first comparator: latest `captured_on` (walk date) wins; ties break on
 * latest `created_at` (approval time); ties break again on `id` ascending.
 *
 * The id tie-break carries no meaning — it exists purely so the result is
 * deterministic. Two observations with identical dates must not swap places
 * between renders (or between the server and the client) depending on the order
 * the rows happened to come back from PostgREST.
 */
function byRecencyDesc(a: CvOrderable, b: CvOrderable): number {
  // Compared, never subtracted: two junk dates both read as -Infinity, and
  // (-Infinity) - (-Infinity) is NaN, which would make the sort incoherent
  // instead of falling through to the next tie-break.
  const desc = (x: number, y: number) => (x === y ? 0 : x > y ? -1 : 1);
  const walked = desc(sortableTime(a.captured_on), sortableTime(b.captured_on));
  if (walked !== 0) return walked;
  const approved = desc(sortableTime(a.created_at), sortableTime(b.created_at));
  if (approved !== 0) return approved;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * The one observation that describes the segment today, or null for an empty
 * list. See {@link byRecencyDesc} for the ordering.
 *
 * This alone drives what the segment "is" on the public surfaces: the shown
 * assessment, the scores/coverage/confidence in the detail panel, and the
 * "Walked" / "Last updated" provenance lines. It does NOT change any counter —
 * cv_count and the map casing/legend keep counting every observation, because
 * totals are provenance, not state.
 */
export function canonicalCvObservation<T extends CvOrderable>(
  list: readonly T[] | null | undefined,
): T | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best: T | null = null;
  for (const o of list) {
    if (!o || typeof o !== "object" || typeof o.id !== "string") continue;
    if (best === null || byRecencyDesc(o, best) < 0) best = o;
  }
  return best;
}

/**
 * The observation list split into the canonical reading and everything it
 * supersedes, archive newest-first.
 *
 * Nothing is dropped: `archived` holds every non-canonical observation, so the
 * detail panel's disclosure can show the full history. The archive is a display
 * concept only — no data is deleted anywhere.
 */
export function splitCvObservations<T extends CvOrderable>(
  list: readonly T[] | null | undefined,
): { canonical: T | null; archived: T[] } {
  const canonical = canonicalCvObservation(list);
  if (canonical === null) return { canonical: null, archived: [] };
  const archived = (list as readonly T[])
    .filter((o) => o && typeof o === "object" && o !== canonical)
    .slice()
    .sort(byRecencyDesc);
  return { canonical, archived };
}
