"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Logo from "@/components/ui/Logo";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";

/**
 * Always-on slim chrome for the full-bleed map: home, locale, theme, and an
 * optional contribute hint. Replaces the demo-banner-as-header pattern in the
 * real-data era while keeping identity and navigation on `/map`.
 */
export default function MapChrome() {
  const t = useTranslations("mapChrome");

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-hairline bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
      <Link
        href="/"
        className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] shrink-0 items-center rounded-[2px] text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <Logo size={18} title={t("home")} />
      </Link>
      <span className="hidden min-w-0 truncate text-[12.5px] text-ink-muted sm:inline">
        {t("tagline")}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
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
        <LocaleSwitcher />
        <ThemeSwitcher className="shrink-0" />
      </div>
    </header>
  );
}
