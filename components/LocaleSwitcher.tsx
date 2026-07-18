"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
] as const;

/**
 * Compact EN|ES switch for persistent chrome (map header, etc.). The active
 * locale is marked; the other links to the same path in that locale.
 */
export default function LocaleSwitcher({
  className,
}: Readonly<{
  className?: string;
}>) {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className={cn("inline-flex items-center", className)}>
      <ul className="inline-flex items-center gap-0.5 font-mono text-[11px] uppercase tracking-[0.08em]">
        {LOCALES.map(({ code, label }) => {
          const active = code === locale;
          return (
            <li key={code}>
              {active ? (
                <span
                  aria-current="true"
                  className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 font-medium text-ink-display"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={pathname}
                  locale={code}
                  className="inline-flex min-h-[32px] pointer-coarse:min-h-[44px] items-center rounded-[2px] px-2 text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
