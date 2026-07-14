"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Lock, LoaderCircle } from "lucide-react";

/**
 * Admin login. Posts the shared password to `/api/admin/login`; on success the
 * server sets an httpOnly session cookie and we navigate to the requested admin
 * page (validated to stay within `/[locale]/admin` to avoid open redirects).
 */
export default function AdminLoginPage() {
  const t = useTranslations("admin.login");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = params.get("from");
  const dest =
    from && from.startsWith(`/${locale}/admin`) ? from : `/${locale}/admin`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(dest);
        router.refresh();
        return;
      }
      if (res.status === 429) {
        const retry = res.headers.get("Retry-After") ?? "60";
        setError(t("errorRateLimited", { seconds: retry }));
      } else if (res.status === 401) {
        setError(t("errorInvalid"));
      } else {
        setError(t("errorGeneric"));
      }
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-[min(24rem,100%)]">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[8px] border border-border bg-surface-elevated text-pine shadow-[var(--shadow-panel)]">
            <Lock size={17} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-pine">
              StreetLens
            </p>
            <h1 className="font-display text-[1.15rem] font-semibold leading-tight text-ink">
              {t("title")}
            </h1>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-[8px] border border-border bg-surface-elevated p-5 shadow-[var(--shadow-panel)]"
        >
          <p className="text-[13px] leading-snug text-neutral-strong">
            {t("subtitle")}
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">
              {t("passwordLabel")}
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              aria-invalid={error ? true : undefined}
              className="rounded-[4px] border border-border bg-surface-base px-3 py-2 font-mono text-[14px] text-ink outline-none transition-colors placeholder:text-neutral focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-pine"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-[4px] border border-[#C0472B]/40 bg-[#C0472B]/8 px-3 py-2 text-[12.5px] font-medium text-[#C0472B]"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-[4px] bg-pine px-4 py-2 text-[13.5px] font-semibold text-surface-elevated transition-colors hover:bg-pine-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? (
              <LoaderCircle
                size={15}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {busy ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
