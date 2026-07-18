import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSegmentDetail, getSegments } from "@/lib/segments";
import { getPendingSubmissions } from "@/lib/submissions";
import { getSessionReview } from "@/lib/capture/review-store";
import { summarizeStreetNames } from "@/lib/capture/segment-label";
import type {
  AddSegmentPayload,
  CvCapturePayload,
  UpdateSegmentPayload,
} from "@/lib/schemas";
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

  let segmentCatalog = new Map<string, { name: string; district: string }>();
  try {
    const collection = await getSegments();
    for (const f of collection.features) {
      segmentCatalog.set(f.properties.id, {
        name: f.properties.name,
        district: f.properties.district,
      });
    }
  } catch {
    segmentCatalog = new Map();
  }

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

      if (item.type === "cv_capture") {
        // The row carries only {session_id} (0014) — capture data lives in the
        // capture_* tables and is deliberately not copied into the payload, so
        // the card reads it rather than trusting a snapshot that could drift.
        const payload = item.payload as CvCapturePayload;
        const review = await getSessionReview(payload.session_id);
        const walkSegmentIds = review
          ? [...new Set(review.frames.map((f) => f.segmentId).filter((id): id is string => Boolean(id)))]
          : [];
        const streetSummary = summarizeStreetNames(
          walkSegmentIds.map((id) => {
            const meta = segmentCatalog.get(id);
            return { id, name: meta?.name, district: meta?.district };
          }),
        );
        return {
          id: item.id,
          type: "cv_capture",
          createdAt: item.created_at,
          geometry: [],
          proposed: {},
          capture: review
            ? {
                sessionId: payload.session_id,
                segments: review.segments.length,
                frames: review.frameCount,
                failedFrames: review.jobs.failed - review.jobs.overbudget,
                overbudget: review.overbudget,
                escalated: review.tokens.escalated,
                streetSummary,
              }
            : {
                // The queue row outlived its session. Say so plainly rather than
                // rendering a walk with zeroes, which would read as "the camera
                // saw nothing" instead of "this cannot be read".
                sessionId: payload.session_id,
                segments: 0,
                frames: 0,
                failedFrames: 0,
                overbudget: false,
                escalated: 0,
                unreadable: true,
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
