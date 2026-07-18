"use client";

import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { cn } from "@/components/ui/cn";

/**
 * Compact three-state theme control (u7): light / system / dark, as a segmented
 * radiogroup with sun / monitor / moon glyphs. i18n EN/ES for the group and each
 * option's accessible label.
 *
 * Styled entirely in `currentColor` so one component reads correctly on every
 * ground it sits over — the neutral admin/map/collect chrome AND the landing's
 * inverted black banner — inheriting whatever ink the parent header sets. The
 * active segment carries a translucent chip; the focus ring is `currentColor`,
 * so it stays visible in both themes.
 */
const ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  system: Monitor,
  dark: Moon,
};

export default function ThemeSwitcher({
  className,
}: Readonly<{ className?: string }>) {
  const t = useTranslations("theme");
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-current/25 p-0.5",
        className,
      )}
    >
      {THEME_PREFERENCES.map((pref) => {
        const Icon = ICONS[pref];
        const active = preference === pref;
        return (
          <button
            key={pref}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`options.${pref}`)}
            title={t(`options.${pref}`)}
            onClick={() => setPreference(pref)}
            className={cn(
              "inline-flex min-h-[28px] min-w-[28px] pointer-coarse:min-h-[36px] pointer-coarse:min-w-[36px] items-center justify-center rounded-full transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-0",
              active
                ? "bg-current/15 opacity-100"
                : "opacity-55 hover:opacity-90",
            )}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
