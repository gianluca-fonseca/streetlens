/**
 * Cheap municipality parameterization (scale doctrine).
 *
 * Escazú is the pilot, not the architecture. New surfaces read the active
 * municipality from this config (env override for future cantons) instead of
 * baking district names or place strings into route code.
 */

export type MunicipalityConfig = {
  /** Short machine id (e.g. esc). */
  id: string;
  /** Display name for public copy. */
  name: string;
  /** Country display name. */
  country: string;
};

const DEFAULT_MUNICIPALITY: MunicipalityConfig = {
  id: "esc",
  name: "Escazú",
  country: "Costa Rica",
};

/** Active municipality for public surfaces. */
export function getMunicipality(): MunicipalityConfig {
  const id = process.env.NEXT_PUBLIC_MUNICIPALITY_ID?.trim();
  const name = process.env.NEXT_PUBLIC_MUNICIPALITY_NAME?.trim();
  const country = process.env.NEXT_PUBLIC_MUNICIPALITY_COUNTRY?.trim();
  return {
    id: id || DEFAULT_MUNICIPALITY.id,
    name: name || DEFAULT_MUNICIPALITY.name,
    country: country || DEFAULT_MUNICIPALITY.country,
  };
}
