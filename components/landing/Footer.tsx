"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

/**
 * A restrained footer on the sunken surface: brand and tagline, the open-data
 * note, the CUSP attribution, a plain-text GitHub label (no fabricated URL),
 * and a one-line locale switch. The active locale is marked; the other links to
 * the same path in that locale via the next-intl navigation Link.
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
    <footer className="border-t border-border bg-surface-sunken">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <p className="font-display text-[1.25rem] font-semibold leading-none tracking-tight text-ink">
              StreetLens
            </p>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-neutral-strong">
              {t("tagline")}
            </p>
          </div>

          <div className="flex flex-col gap-3 text-[0.9rem]">
            <span className="font-medium text-ink">{t("github")}</span>
            <div className="flex items-center gap-3">
              <span className="text-neutral-strong">{t("localeLabel")}</span>
              <ul className="flex items-center gap-2">
                {LOCALES.map(({ code, label }) => {
                  const active = code === locale;
                  return (
                    <li key={code}>
                      {active ? (
                        <span
                          aria-current="true"
                          className="font-medium text-ink"
                        >
                          {label}
                        </span>
                      ) : (
                        <Link
                          href={pathname}
                          locale={code}
                          className={cn(
                            "text-neutral-strong underline-offset-4 hover:text-ink hover:underline",
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
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-[12.5px] leading-relaxed text-neutral-strong">
            {t("openData")}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-strong">
            {t("built")}
          </p>
        </div>
      </div>
    </footer>
  );
}
