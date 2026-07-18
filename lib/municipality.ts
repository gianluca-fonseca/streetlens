/**
 * Municipality parameterization — the one cheap seam, composed from both
 * bgsd-0014 lanes that independently invented it.
 *
 * Escazú is the pilot, not the architecture: the pilot's values are the
 * DEFAULTS here, and a future deployment overrides them with
 * NEXT_PUBLIC_MUNICIPALITY_* env vars without touching code. Civic surfaces
 * (brief, press, open-data) read the richer branded MUNICIPALITY const;
 * runtime copy (QR onboarding) reads getMunicipalityConfig()/municipalityName
 * so env overrides flow through. Do not invent a tenancy rewrite.
 */

export type LocaleCode = "en" | "es";

export type MunicipalityRuntimeConfig = Readonly<{
  id: string;
  name: Record<LocaleCode, string>;
  region: Record<LocaleCode, string>;
  projectName: string;
}>;

const DEFAULTS: MunicipalityRuntimeConfig = {
  id: "esc",
  name: { en: "Escazú", es: "Escazú" },
  region: { en: "Costa Rica", es: "Costa Rica" },
  projectName: "StreetLens",
};

/** Server or client — reads public env vars only; pilot values as defaults. */
export function getMunicipalityConfig(): MunicipalityRuntimeConfig {
  return {
    id: process.env.NEXT_PUBLIC_MUNICIPALITY_ID?.trim() || DEFAULTS.id,
    name: {
      en: process.env.NEXT_PUBLIC_MUNICIPALITY_NAME_EN?.trim() || DEFAULTS.name.en,
      es: process.env.NEXT_PUBLIC_MUNICIPALITY_NAME_ES?.trim() || DEFAULTS.name.es,
    },
    region: {
      en: process.env.NEXT_PUBLIC_MUNICIPALITY_REGION_EN?.trim() || DEFAULTS.region.en,
      es: process.env.NEXT_PUBLIC_MUNICIPALITY_REGION_ES?.trim() || DEFAULTS.region.es,
    },
    projectName: process.env.NEXT_PUBLIC_PROJECT_NAME?.trim() || DEFAULTS.projectName,
  };
}

export function municipalityName(locale: LocaleCode): string {
  return getMunicipalityConfig().name[locale];
}

/**
 * Branded civic identity for the pilot's outward-facing pages (brief, press,
 * open-data copy). Name/country follow the runtime config so env overrides
 * reach the civic surfaces too; the asset paths and contacts are deploy-level.
 */
export const MUNICIPALITY = {
  /** Short display name used in titles and briefing headers. */
  get name(): string {
    return getMunicipalityConfig().name.en;
  },
  /** ISO-ish country label for bylines. */
  get country(): string {
    return getMunicipalityConfig().region.en;
  },
  /** Stable id prefix used on segment ids (e.g. esc-*). Informational only. */
  get id(): string {
    return getMunicipalityConfig().id;
  },
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
