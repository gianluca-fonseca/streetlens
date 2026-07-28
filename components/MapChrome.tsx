"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Logo from "@/components/ui/Logo";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import DemoDataToggle from "@/components/DemoDataToggle";

/**
 * Always-on slim chrome for the full-bleed map: home, the demo-data switch,
 * locale, theme, and an optional contribute hint. Replaces the
 * demo-banner-as-header pattern in the real-data era while keeping identity and
 * navigation on `/map`.
 *
 * The demo switch lives here, not in `DemoBanner`, for one reason: the banner
 * only exists while the demo era is on, so a switch inside it would be a
 * one-way door. This chrome is always mounted, so the control reads the same
 * and works in both directions.
 */
export default function MapChrome() {
  const t = useTranslations("mapChrome");

  return (
    // `flex-wrap` is load-bearing at 360px in Spanish. The right cluster is
    // shrink-0 and needed 333px there (the demo switch alone is 135px in
    // Spanish against 110px in English); with the logo and the gap that is
    // 363px inside a 336px content box, and the theme switcher's right edge
    // measured 375px against a 360px header. The page reported no horizontal
    // scroll only because the layout viewport had itself widened to 376px to
    // absorb it, which is why both static sweeps missed it. Wrapping lets the
    // cluster take its own row exactly where it does not fit; at 390px it
    // still measures 363px inside 366px and stays on one row, so every
    // viewport above the smallest is untouched.
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:flex-nowrap sm:px-4">
      <Link
        href="/"
        className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] shrink-0 items-center rounded-[2px] text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <Logo size={18} title={t("home")} />
      </Link>
      <span className="hidden min-w-0 truncate text-[12.5px] text-ink-muted sm:inline">
        {t("tagline")}
      </span>
      {/* gap-1.5 below sm buys back 4px, which is the difference between the
          English cluster fitting on one row at 360px (334px inside a 336px box)
          and wrapping for the sake of 2px. Spanish needs 355px there and wraps
          regardless, which is the correct outcome for it. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <Link
          href="/insights"
          className="hidden min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 text-[12px] font-medium text-ink-muted underline decoration-accent decoration-2 underline-offset-[4px] transition-colors hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          {t("insights")}
        </Link>
        <Link
          href="/map?contribute=1"
          className="hidden min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 text-[12px] font-medium text-ink-muted underline decoration-accent decoration-2 underline-offset-[4px] transition-colors hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          {t("contribute")}
        </Link>
        <DemoDataToggle />
        <LocaleSwitcher />
        <ThemeSwitcher className="shrink-0" />
      </div>
    </header>
  );
}
