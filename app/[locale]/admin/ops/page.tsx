import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import AdminHeader from "@/components/admin/AdminHeader";
import OpsDashboard from "@/components/admin/OpsDashboard";
import { getOpsDashboard } from "@/lib/ops/ops-store";

export const dynamic = "force-dynamic";

export default async function AdminOpsPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.ops" });
  const data = await getOpsDashboard();

  return (
    <>
      <AdminHeader locale={locale} active="ops" />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-strong">{t("subtitle")}</p>
        </div>
        <OpsDashboard data={data} locale={locale} />
      </main>
    </>
  );
}
