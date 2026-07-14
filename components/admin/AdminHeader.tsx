import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutGrid, ListChecks, Map } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import LogoutButton from "./LogoutButton";

/**
 * Admin top bar: brand, primary nav (overview / queue), locale toggle, a link
 * back to the public map, and logout. Server component; the only client island
 * is the logout button.
 */
export default async function AdminHeader({
  locale,
  active,
}: Readonly<{
  locale: Locale;
  active: "dashboard" | "queue";
}>) {
  const t = await getTranslations({ locale, namespace: "admin" });
  const other: Locale = locale === "en" ? "es" : "en";
  const suffix = active === "queue" ? "/queue" : "";

  const nav = [
    {
      key: "dashboard" as const,
      href: `/${locale}/admin`,
      label: t("nav.dashboard"),
      Icon: LayoutGrid,
    },
    {
      key: "queue" as const,
      href: `/${locale}/admin/queue`,
      label: t("nav.queue"),
      Icon: ListChecks,
    },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface-elevated/95 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        <span className="font-display text-[0.98rem] font-semibold tracking-tight text-ink">
          {t("brand")}
        </span>

        <nav className="flex items-center gap-1" aria-label={t("brand")}>
          {nav.map(({ key, href, label, Icon }) => {
            const isActive = key === active;
            return (
              <Link
                key={key}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  isActive
                    ? "border-border-strong bg-surface-sunken text-ink"
                    : "border-transparent text-neutral-strong hover:border-border hover:text-ink",
                ].join(" ")}
              >
                <Icon
                  size={14}
                  strokeWidth={1.75}
                  className={isActive ? "text-pine" : "text-neutral-strong"}
                  aria-hidden="true"
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/${other}/admin${suffix}`}
            className="rounded-[4px] border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-strong transition-colors hover:border-border-strong hover:text-ink"
          >
            {other}
          </Link>
          <Link
            href={`/${locale}`}
            className="hidden items-center gap-1.5 rounded-[4px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[12.5px] font-medium text-neutral-strong transition-colors hover:border-border-strong hover:text-ink sm:inline-flex"
          >
            <Map size={14} strokeWidth={1.75} aria-hidden="true" />
            {t("nav.publicMap")}
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
