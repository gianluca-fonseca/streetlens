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
