/**
 * Theme system — shared constants and the pre-paint resolver (u7).
 *
 * Mechanism: a class strategy. `.dark` or `.light` is written onto <html> before
 * first paint by THEME_INIT_SCRIPT (below), so there is no flash of the wrong
 * theme. The stored PREFERENCE is one of three states — light / dark / system —
 * and "system" resolves against `prefers-color-scheme` at read time (and re-
 * resolves live when the OS flips). CSS tokens in globals.css key off the `.dark`
 * class; a `prefers-color-scheme` fallback covers the JS-off case.
 *
 * The MapLibre instrument (basemap + score ramps in components/mapConfig.ts /
 * AuditMap.tsx) is intentionally NOT wired to this class — it keys off the OS
 * setting independently, so flipping the in-app switcher never changes the map.
 * The instrument does not change with the lighting (sealed).
 */

export const THEME_STORAGE_KEY = "streetlens-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "light",
  "system",
  "dark",
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** The OS setting right now (light on the server / no matchMedia). */
export function getSystemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/** Resolve a stored preference to the concrete theme that should render. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

/**
 * Read the persisted preference (client only). Defaults to "system" when unset
 * or unreadable (private-mode localStorage throws).
 */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/**
 * Apply a preference to the document: write the resolved `.light`/`.dark` class
 * and the matching `color-scheme` (so native form controls / scrollbars follow),
 * and persist the choice. Returns the resolved theme actually applied.
 */
export function applyPreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== "undefined") {
    const el = document.documentElement;
    el.classList.remove("light", "dark");
    el.classList.add(resolved);
    el.style.colorScheme = resolved;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      /* persistence is best-effort; the class still applied */
    }
  }
  return resolved;
}

/**
 * The no-flash init script. Runs synchronously at the very top of <body>, before
 * any content paints, so the correct class is on <html> from the first frame.
 * Mirrors resolveTheme/applyPreference but self-contained (no imports at runtime)
 * and defensively wrapped — a throw here must never block the page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system"){p="system";}var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(d?"dark":"light");e.style.colorScheme=d?"dark":"light";}catch(err){}})();`;
