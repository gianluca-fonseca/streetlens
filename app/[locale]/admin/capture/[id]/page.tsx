/**
 * /[locale]/admin/capture/[id] — review one camera walk.
 *
 * The page a cv_capture queue card links to. It exists separately from the queue
 * because a walk is judged per SEGMENT: the camera is often right about one
 * street and wrong about the next, and one verdict for the whole session would
 * force an admin to throw away good observations to reject bad ones.
 *
 * Guarded by proxy.ts (which DOES cover pages, unlike /api), and the action it
 * posts to re-verifies the cookie itself.
 *
 * Next 16: `params` is a Promise and must be awaited.
 */

import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSessionReview } from "@/lib/capture/review-store";
import { getSegments } from "@/lib/segments";
import AdminHeader from "@/components/admin/AdminHeader";
import CaptureReview from "@/components/admin/CaptureReview";
import type { MatchedGeometry } from "@/components/admin/ReviewMap";

export const dynamic = "force-dynamic";

export default async function AdminCaptureReviewPage({
  params,
}: Readonly<{
  params: Promise<{ locale: Locale; id: string }>;
}>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "admin.capture" });

  const review = await getSessionReview(id);
  if (!review) notFound();

  // Real geometry for the matched segments, so the review map draws them where they
  // actually are. Joined by id from the same collection the public map reads; a
  // segment with no geometry (unknown id) is simply skipped.
  const matchedIds = new Set(
    review.frames.map((f) => f.segmentId).filter((id): id is string => Boolean(id)),
  );
  let matchedGeometry: MatchedGeometry[] = [];
  if (matchedIds.size > 0) {
    try {
      const collection = await getSegments();
      matchedGeometry = collection.features
        .filter((f) => matchedIds.has(f.properties.id))
        .map((f) => ({
          id: f.properties.id,
          coordinates: f.geometry.coordinates.map(
            (c) => [c[0], c[1]] as [number, number],
          ),
        }));
    } catch {
      // The map degrades to track + dots without segment highlights; not fatal.
      matchedGeometry = [];
    }
  }

  return (
    <>
      <AdminHeader locale={locale} active="queue" />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-ink">
            {t("title")}
          </h1>
          <p className="mt-0.5 font-mono text-[12px] text-neutral-strong">
            {review.sessionId}
          </p>
        </div>

        <CaptureReview review={review} matchedGeometry={matchedGeometry} />
      </main>
    </>
  );
}
