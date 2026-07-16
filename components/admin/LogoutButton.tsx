"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LogOut } from "lucide-react";

/** Clears the session cookie via the API, then returns to the login page. */
export default function LogoutButton() {
  const t = useTranslations("admin.nav");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      /* clearing the cookie is best-effort; navigate regardless */
    }
    router.replace(`/${locale}/admin/login`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[12.5px] font-medium text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-55"
    >
      <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
      {t("logout")}
    </button>
  );
}
