"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

/**
 * A centered colophon on the sunken surface: the wordmark, the tagline, a
 * one-line locale switch, and the open-data / attribution notes. The active
 * locale is marked; the other links to the same path in that locale via the
 * next-intl navigation Link. Targets stay 44px for touch.
 */
const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export default function Footer() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <footer className="border-t border-hairline bg-surface-sunken">
      <div className="mx-auto max-w-[42.5rem] px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] py-14 text-center">
        <p className="font-display text-[1.25rem] font-bold leading-none tracking-[-0.02em] text-ink-display">
          StreetLens
        </p>
        <p className="mx-auto mt-3 max-w-[34rem] font-serif text-[1rem] leading-[1.5] text-ink-muted">
          {t("tagline")}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[12px] uppercase tracking-[0.08em]">
          <span className="text-ink-muted">{t("github")}</span>
          <span aria-hidden="true" className="h-3 w-px bg-hairline-strong" />
          <span className="text-ink-muted">{t("localeLabel")}</span>
          <ul className="flex items-center gap-1">
            {LOCALES.map(({ code, label }) => {
              const active = code === locale;
              return (
                <li key={code}>
                  {active ? (
                    <span
                      aria-current="true"
                      className="inline-flex min-h-[44px] items-center px-2 font-medium text-ink-display"
                    >
                      {label}
                    </span>
                  ) : (
                    <Link
                      href={pathname}
                      locale={code}
                      className={cn(
                        "inline-flex min-h-[44px] items-center rounded-[2px] px-2 text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      {label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mx-auto mt-8 max-w-[36rem] border-t border-hairline pt-6">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {t("openData")}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
            {t("built")}
          </p>
        </div>
      </div>
    </footer>
  );
}
