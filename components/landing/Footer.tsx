"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";
import Logo from "@/components/ui/Logo";
import { AUTHOR_LINKEDIN, CUSP_URL, GITHUB_URL } from "@/lib/links";

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

/** The official LinkedIn "in" mark in `currentColor`, taking the bold `--ink`
 * tone of the author name beside it. Founder-sanctioned icon-ban exception, scoped
 * to the author pill (parity with the hero pill). */
function LinkedInMark({
  size = 13,
  className,
}: Readonly<{ size?: number; className?: string }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 448 512"
      fill="currentColor"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3zM135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.3 0 79.7 44.3 79.7 101.9V416z" />
    </svg>
  );
}

export default function Footer() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <footer className="border-t border-hairline bg-surface-sunken">
      <div className="mx-auto max-w-[42.5rem] px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] py-14 text-center">
        <div className="flex flex-col items-center text-ink-display">
          <Logo withWordmark size={23} title="StreetLens" />
          {/* The wordmark sits over a quiet "by CUSP" credit (parity with the
              hero lockup). This folds the CUSP attribution in, so the colophon
              never names CUSP twice. Pink underline is the on-hover link signal. */}
          <a
            href={CUSP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-1 inline-flex min-h-[24px] pointer-coarse:min-h-[44px] items-center font-mono text-[11px] font-medium normal-case tracking-normal text-ink-muted underline-offset-[3px] transition-colors hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span className="group-hover:underline group-hover:decoration-accent group-hover:decoration-2">
              {t("byCusp")}
            </span>
          </a>
        </div>
        <p className="mx-auto mt-3 max-w-[34rem] font-serif text-[1rem] leading-[1.5] text-ink-muted">
          {t("tagline")}
        </p>

        <nav
          aria-label={t("insights")}
          className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[12px] uppercase tracking-[0.08em]"
        >
          <Link
            href="/insights"
            className="inline-flex min-h-[44px] items-center rounded-[2px] text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("insights")}
          </Link>
          <Link
            href="/method"
            className="inline-flex min-h-[44px] items-center rounded-[2px] text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("method")}
          </Link>
          <Link
            href="/rubric"
            className="inline-flex min-h-[44px] items-center rounded-[2px] text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("rubric")}
          </Link>
        </nav>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[12px] uppercase tracking-[0.08em]">
          <a
            href={AUTHOR_LINKEDIN}
            target="_blank"
            rel="noopener noreferrer"
            className="sl-card group inline-flex min-h-[36px] pointer-coarse:min-h-[44px] items-center gap-2 rounded-full border border-hairline bg-paper-white py-1 pl-1 pr-3 font-sans text-[11.5px] font-medium normal-case tracking-normal text-ink-muted hover:text-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Image
              src="/gianluca.jpg"
              alt=""
              width={44}
              height={44}
              className="h-6 w-6 shrink-0 rounded-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-105"
            />
            <span className="inline-flex items-center gap-1.5">
              {t.rich("madeBy", {
                name: (chunks) => (
                  <span className="font-semibold text-ink-display underline-offset-[3px] group-hover:underline group-hover:decoration-accent group-hover:decoration-2">
                    {chunks}
                  </span>
                ),
              })}
              <LinkedInMark className="text-ink-display" />
            </span>
          </a>
          <span aria-hidden="true" className="h-3 w-px bg-hairline-strong" />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-[2px] text-ink-muted underline-offset-4 transition-colors hover:text-ink-display hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("openSource")}
            <span aria-hidden="true">→</span>
            {t("github")}
          </a>
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
