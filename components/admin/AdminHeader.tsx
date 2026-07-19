import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { History, LayoutGrid, ListChecks, Map, Upload, Activity } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { LogoMark } from "@/components/ui/Logo";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import LogoutButton from "./LogoutButton";

/**
 * Admin top bar: brand, primary nav (overview / queue / import), locale toggle,
 * a link back to the public map, and logout. Server component; the only client
 * island is the logout button.
 */
export default async function AdminHeader({
  locale,
  active,
}: Readonly<{
  locale: Locale;
  active: "dashboard" | "queue" | "history" | "import" | "ops";
}>) {
  const t = await getTranslations({ locale, namespace: "admin" });
  const other: Locale = locale === "en" ? "es" : "en";
  const suffix =
    active === "queue"
      ? "/queue"
      : active === "history"
        ? "/history"
        : active === "import"
          ? "/import"
          : active === "ops"
            ? "/ops"
            : "";

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
    {
      key: "history" as const,
      href: `/${locale}/admin/history`,
      label: t("nav.history"),
      Icon: History,
    },
    {
      key: "import" as const,
      href: `/${locale}/admin/import`,
      label: t("nav.import"),
      Icon: Upload,
    },
    {
      key: "ops" as const,
      href: `/${locale}/admin/ops`,
      label: t("nav.ops"),
      Icon: Activity,
    },
  ];

  return (
    // Flat admin ground: solid surface, NO backdrop-blur (glass is sanctioned only
    // over live map tiles, per the zen dossier §2/§6).
    <header className="sticky top-0 z-10 border-b border-border bg-surface-elevated">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        <span className="flex items-center gap-2 font-display text-[0.98rem] font-semibold tracking-tight text-ink">
          <LogoMark size={19} />
          {t("brand")}
        </span>

        <nav className="flex flex-wrap items-center gap-1" aria-label={t("brand")}>
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
                  className={isActive ? "text-ink" : "text-neutral-strong"}
                  aria-hidden="true"
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher className="text-neutral-strong" />
          <Link
            href={`/${other}/admin${suffix}`}
            className="rounded-[4px] border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-strong transition-colors hover:border-border-strong hover:text-ink"
          >
            {other}
          </Link>
          <Link
            href={`/${locale}/map`}
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
