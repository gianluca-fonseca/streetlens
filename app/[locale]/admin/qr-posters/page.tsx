import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import type { Locale } from "@/i18n/routing";
import AdminHeader from "@/components/admin/AdminHeader";
import QrPosterPanel from "@/components/admin/QrPosterPanel";

export const dynamic = "force-dynamic";

export default async function AdminQrPostersPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.qrPosters" });
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3584";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const defaultOrigin = `${proto}://${host}`;

  return (
    <>
      <AdminHeader locale={locale} active="dashboard" />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-neutral-strong">{t("subtitle")}</p>
        </div>
        <QrPosterPanel locale={locale} defaultOrigin={defaultOrigin} />
      </main>
    </>
  );
}
