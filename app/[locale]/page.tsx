import { promises as fs } from "fs";
import path from "path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import AuditMap, { type SegmentCollection } from "@/components/AuditMap";
import DemoBanner from "@/components/DemoBanner";

async function loadDemoSegments(): Promise<SegmentCollection> {
  const raw = await fs.readFile(
    path.join(process.cwd(), "data", "demo-segments.geojson"),
    "utf8",
  );
  return JSON.parse(raw) as SegmentCollection;
}

export default async function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const segments = await loadDemoSegments();

  return (
    <>
      <DemoBanner />
      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-16 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("title")}
          </h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-400">
            {t("tagline")}
          </p>
          <p className="max-w-xl text-sm text-neutral-500 dark:text-neutral-500">
            {t("subtext")}
          </p>

          <div className="mt-6 rounded-lg border border-neutral-200 px-8 py-5 dark:border-neutral-800">
            <p className="text-3xl font-semibold tabular-nums">
              {t("stat.value")}
              <span className="text-lg font-normal text-neutral-500">
                {t("stat.unit")}
              </span>
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t("stat.label")}
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500">
              {t("stat.demoNote")}
            </p>
          </div>
        </section>

        <section className="w-full">
          <h2 className="sr-only">{t("mapHeading")}</h2>
          <AuditMap segments={segments} />
        </section>
      </main>
    </>
  );
}
