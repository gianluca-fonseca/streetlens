/**
 * Municipality-facing copy and identifiers — parameterized, not hardcoded to a pilot.
 *
 * Defaults are generic; the pilot sets NEXT_PUBLIC_MUNICIPALITY_* in deployment.
 */

export type LocaleCode = "en" | "es";

export type MunicipalityConfig = Readonly<{
  id: string;
  name: Record<LocaleCode, string>;
  region: Record<LocaleCode, string>;
  projectName: string;
}>;

const DEFAULTS: MunicipalityConfig = {
  id: "pilot",
  name: { en: "your municipality", es: "su municipio" },
  region: { en: "your region", es: "su región" },
  projectName: "StreetLens",
};

/** Server or client — reads public env vars only. */
export function getMunicipalityConfig(): MunicipalityConfig {
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
