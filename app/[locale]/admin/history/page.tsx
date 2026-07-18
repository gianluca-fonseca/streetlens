import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import {
  getSubmissionCounts,
  getSubmissionHistory,
} from "@/lib/submissions";
import type {
  AddSegmentPayload,
  CvCapturePayload,
  UpdateSegmentPayload,
} from "@/lib/schemas";
import AdminHeader from "@/components/admin/AdminHeader";
import HistoryList, {
  type HistoryRowView,
} from "@/components/admin/HistoryList";

// Admin figures must reflect the live dataset, never a build snapshot — same
// contract as the queue and the overview hub.
export const dynamic = "force-dynamic";

/**
 * /[locale]/admin/history — every submission ever, newest first, filterable by
 * status and type. A presentation layer over lib/submissions.ts: the same
 * reconciled source the queue and the counters read, so nothing here recomputes
 * status. Payload parsing stays here (server) and the client gets display-ready
 * rows; an invalid/unknown row arrives readable-flagged, never dropped.
 */
export default async function AdminHistoryPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.history" });

  const [{ items, source, total, cap }, counts] = await Promise.all([
    getSubmissionHistory(),
    getSubmissionCounts(),
  ]);

  const rows: HistoryRowView[] = items.map((item) => {
    const base = {
      id: item.id,
      status: item.status,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
      reviewerNote: item.reviewer_note,
      payloadReadable: item.payloadValid,
    };

    if (item.type === "add_segment") {
      const payload = item.payloadValid
        ? (item.payload as AddSegmentPayload)
        : null;
      return { ...base, type: "add_segment", detail: payload?.name ?? null };
    }
    if (item.type === "update_segment") {
      const payload = item.payloadValid
        ? (item.payload as UpdateSegmentPayload)
        : null;
      // The target segment id is the most useful at-a-glance handle for an edit.
      return {
        ...base,
        type: "update_segment",
        detail: payload?.segment_id ?? null,
      };
    }
    if (item.type === "cv_capture") {
      const payload = item.payloadValid
        ? (item.payload as CvCapturePayload)
        : null;
      return {
        ...base,
        type: "cv_capture",
        sessionId: payload?.session_id ?? null,
        detail: null,
      };
    }
    return { ...base, type: "unknown", detail: null };
  });

  return (
    <>
      <AdminHeader locale={locale} active="history" />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-strong">
            {t("subtitle")}
          </p>
        </div>

        <HistoryList
          rows={rows}
          counts={counts}
          isSample={source === "sample"}
          total={total}
          cap={cap}
        />
      </main>
    </>
  );
}
