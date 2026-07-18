import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/routing";
import Logo from "@/components/ui/Logo";
import { MUNICIPALITY } from "@/lib/municipality";

/**
 * Shared chrome for civic public pages (brief / data / press).
 * Scrollable (landing pattern) so print + long tables work under the
 * layout's overflow-hidden body.
 */
export default function CivicChrome({
  locale,
  homeLabel,
  children,
  actions,
}: Readonly<{
  locale: Locale;
  homeLabel: string;
  children: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <main className="civic-page min-h-0 flex-1 overflow-y-auto scroll-smooth bg-surface text-ink">
      <header className="civic-no-print sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href={`/${locale}`}
            className="inline-flex min-h-[44px] items-center gap-2 text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo withWordmark size={22} title="StreetLens" />
          </Link>
          <div className="flex items-center gap-2">
            {actions}
            <Link
              href={`/${locale}`}
              className="inline-flex min-h-[44px] items-center px-2 text-[12px] font-mono uppercase tracking-[0.08em] text-ink-muted underline-offset-4 hover:text-ink-display hover:underline"
            >
              {homeLabel}
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          StreetLens · {MUNICIPALITY.name}, {MUNICIPALITY.country}
        </p>
        {children}
      </div>
    </main>
  );
}
