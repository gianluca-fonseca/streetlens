import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSupabaseClient } from "@/lib/supabase";
import AdminHeader from "@/components/admin/AdminHeader";
import ImportPanel from "@/components/admin/ImportPanel";

// Reads env for the local/DB banner; the panel itself is a client island.
export const dynamic = "force-dynamic";

/**
 * Admin bulk import: dry-run validation preview first, then an explicit commit
 * through the single apply pipeline (advisor ruling 4). Editorial, data-dense
 * per the design direction. Auth is enforced by the proxy guard (matcher covers
 * /[locale]/admin/**); the API route re-verifies the session independently.
 */
export default async function AdminImportPage({
  params,
}: Readonly<{ params: Promise<{ locale: Locale }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.import" });
  const localMode = getSupabaseClient() === null;

  return (
    <>
      <AdminHeader locale={locale} active="import" />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-neutral-strong">
            {t("subtitle")}
          </p>
        </div>

        <ImportPanel localMode={localMode} />
      </main>
    </>
  );
}
