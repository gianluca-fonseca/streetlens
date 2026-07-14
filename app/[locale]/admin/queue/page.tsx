import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegmentDetail } from "@/lib/segments";
import { getPendingSubmissions } from "@/lib/submissions";
import type { AddSegmentPayload, UpdateSegmentPayload } from "@/lib/schemas";
import AdminHeader from "@/components/admin/AdminHeader";
import QueueList, { type QueueItemView } from "@/components/admin/QueueList";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.queue" });

  const { items, source } = await getPendingSubmissions();

  // Enrich each item for display. For updates, join the current segment values
  // so the queue can render a field-by-field diff.
  const views: QueueItemView[] = await Promise.all(
    items.map(async (item): Promise<QueueItemView> => {
      if (item.type === "add_segment") {
        const payload = item.payload as AddSegmentPayload;
        return {
          id: item.id,
          type: "add_segment",
          createdAt: item.created_at,
          geometry: payload.coordinates as [number, number][],
          proposed: {
            name: payload.name,
            highway: payload.highway,
            note: payload.note ?? null,
          },
        };
      }

      const payload = item.payload as UpdateSegmentPayload;
      const current = await getSegmentDetail(payload.segment_id);
      return {
        id: item.id,
        type: "update_segment",
        createdAt: item.created_at,
        geometry: (current?.geometry.coordinates ?? []) as [number, number][],
        proposed: {
          name: payload.patch.name,
          highway: payload.patch.highway,
          note: payload.patch.note,
        },
        current: {
          name: current?.name ?? null,
          highway: current?.highway ?? null,
          note: null,
        },
        contributorReason: payload.reason,
      };
    }),
  );

  const count = views.length;
  const subtitle =
    count === 0
      ? t("subtitleZero")
      : count === 1
        ? t("subtitleOne", { count })
        : t("subtitleMany", { count });

  return (
    <>
      <AdminHeader locale={locale} active="queue" />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-strong">{subtitle}</p>
        </div>

        <QueueList items={views} isSample={source === "sample"} />
      </main>
    </>
  );
}
