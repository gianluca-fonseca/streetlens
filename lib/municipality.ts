/**
 * Pilot municipality branding — the one cheap parameterization seam.
 *
 * Escazú is the pilot, not the architecture. New civic surfaces (brief, press,
 * open-data copy) read the municipality name from here instead of hardcoding
 * another Escazú string. Swap this object when a new pilot comes online; do not
 * invent a tenancy rewrite.
 */

export const MUNICIPALITY = {
  /** Short display name used in titles and briefing headers. */
  name: "Escazú",
  /** ISO-ish country label for bylines. */
  country: "Costa Rica",
  /** Stable id prefix used on segment ids (e.g. esc-*). Informational only. */
  id: "esc",
  /** Rubric version stamped on open-data rows. */
  rubricVersion: "v0.1",
  /** Public press / civic contact (GitHub issues; no personal inbox on the wire). */
  contactUrl: "https://github.com/gianluca-fonseca/streetlens/issues/new",
  contactLabel: "GitHub Issues",
  /** Downloadable brand marks under public/. */
  brandMarkLight: "/brand/streetlens-mark-light.svg",
  brandMarkDark: "/brand/streetlens-mark-dark.svg",
  /** Sealed atlas render for the press kit. */
  pressHero: "/render/atlas-wide.svg",
} as const;

export type MunicipalityConfig = typeof MUNICIPALITY;
