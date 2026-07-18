import { Link } from "@/i18n/navigation";
import Logo from "@/components/ui/Logo";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";

/**
 * Slim chrome for public document surfaces (insights / method / rubric).
 */
export default function PublicDocChrome({
  homeLabel,
  insightsLabel,
  methodLabel,
  rubricLabel,
  mapLabel,
  active,
}: Readonly<{
  homeLabel: string;
  insightsLabel: string;
  methodLabel: string;
  rubricLabel: string;
  mapLabel: string;
  active?: "insights" | "method" | "rubric";
}>) {
  const linkClass = (key: typeof active) =>
    [
      "inline-flex min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active === key
        ? "text-ink-display underline decoration-accent decoration-2 underline-offset-[4px]"
        : "text-ink-muted hover:text-ink-display",
    ].join(" ");

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-3 sm:px-4">
      <Link
        href="/"
        className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] shrink-0 items-center rounded-[2px] text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Logo size={18} title={homeLabel} />
      </Link>
      <nav
        aria-label={homeLabel}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:gap-2"
      >
        <Link href="/insights" className={linkClass("insights")}>
          {insightsLabel}
        </Link>
        <Link href="/method" className={linkClass("method")}>
          {methodLabel}
        </Link>
        <Link href="/rubric" className={linkClass("rubric")}>
          {rubricLabel}
        </Link>
        <Link
          href="/map"
          className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 text-[12px] font-medium text-ink-muted underline decoration-accent decoration-2 underline-offset-[4px] hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {mapLabel}
        </Link>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <LocaleSwitcher />
        <ThemeSwitcher className="shrink-0" />
      </div>
    </header>
  );
}
