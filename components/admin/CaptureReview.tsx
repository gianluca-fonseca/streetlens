"use client";

/**
 * Reviewing one camera walk (u30).
 *
 * The judgement is PER SEGMENT. Every segment starts ticked (the common case is
 * "the walk is fine"), and the admin unticks what the camera got wrong. Approving
 * publishes exactly the ticked set and retracts the rest, so changing your mind
 * later is a real operation rather than an append.
 *
 * Nothing here is presented as an audit. These are camera readings: a null lens
 * is UNKNOWN and renders as "unset", never as a zero, because zero would claim
 * the camera saw a failing street rather than admitting no frame supported it.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Check, FlaskConical, TriangleAlert, X } from "lucide-react";
import type { SessionReview } from "@/lib/capture/review-store";
import styles from "@/components/ui/zen.module.css";

const LENS_ORDER = ["overall", "accessibility", "drainage", "shade", "bike"] as const;

/** 0-1 → a whole percent. Null stays null: unknown is not zero. */
function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

export default function CaptureReview({
  review,
}: Readonly<{ review: SessionReview }>) {
  const t = useTranslations("admin.capture");
  const tl = useTranslations("layers");
  const locale = useLocale();
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(review.segments.map((s) => s.segmentId)),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const numFmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const decided = review.status === "approved" || review.status === "rejected";

  function toggle(segmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }

  async function submit(action: "approve" | "reject") {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError(t("reasonRequired"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/capture/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: review.sessionId,
          action,
          reason: trimmed,
          segment_ids: action === "approve" ? [...selected] : [],
        }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(t("errorGeneric"));
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {review.source === "fixture" ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3.5 py-2 text-[12.5px] font-medium text-ink"
        >
          <FlaskConical size={14} strokeWidth={1.75} className="shrink-0 text-amber" aria-hidden="true" />
          <span>{t("fixtureNote")}</span>
        </div>
      ) : null}

      {decided ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3.5 py-2 text-[12.5px] font-medium text-ink"
        >
          <Check size={14} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
          <span>
            {t(review.status === "approved" ? "alreadyApproved" : "alreadyRejected")}
            {review.reviewedAt ? ` · ${dateFmt.format(new Date(review.reviewedAt))}` : ""}
          </span>
        </div>
      ) : null}

      {/* What the walk cost and what went wrong. Shown before the segments so an
          admin knows whether to trust what follows. */}
      <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-4`}>
        <h2 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("sessionHeading")}
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-neutral-strong">{t("statusLabel")}</dt>
            <dd className="font-mono font-medium text-ink">{t(`status.${review.status}`)}</dd>
          </div>
          <div>
            <dt className="text-neutral-strong">{t("framesLabel")}</dt>
            <dd className="font-mono font-medium text-ink">{numFmt.format(review.frameCount)}</dd>
          </div>
          <div>
            <dt className="text-neutral-strong">{t("capturedLabel")}</dt>
            <dd className="font-mono font-medium text-ink">
              {review.capturedOn ? review.capturedOn.slice(0, 10) : t("unset")}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-strong">{t("tokensLabel")}</dt>
            <dd className="font-mono font-medium text-ink">
              {numFmt.format(review.tokens.inputTokens + review.tokens.outputTokens)}
            </dd>
          </div>
        </dl>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-neutral-strong">
            {t("jobsDone", { count: review.jobs.done })}
          </li>
          {review.jobs.failed - review.jobs.overbudget > 0 ? (
            <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-clay/45 bg-clay/10 px-2 py-0.5 text-[11px] font-medium text-clay">
              <X size={12} strokeWidth={2} aria-hidden="true" />
              {t("jobsFailed", { count: review.jobs.failed - review.jobs.overbudget })}
            </li>
          ) : null}
          {review.overbudget ? (
            // Separate from "failed" on purpose: the money ran out, the frames
            // were never looked at. Conflating them would tell an admin the walk
            // was worse than it was.
            <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-amber/45 bg-amber/10 px-2 py-0.5 text-[11px] font-medium text-ink">
              <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
              {t("overbudget")}
            </li>
          ) : null}
          {review.tokens.escalated > 0 ? (
            <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-neutral-strong">
              {t("escalated", { count: review.tokens.escalated })}
            </li>
          ) : null}
          {review.unattributedFrames > 0 ? (
            <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-neutral-strong">
              {t("unattributed", { count: review.unattributedFrames })}
            </li>
          ) : null}
        </ul>
      </section>

      {review.segments.length === 0 ? (
        // A walk that produced nothing still reaches review (pump.ts rolls up
        // with zero rollups deliberately). Say what happened rather than showing
        // an empty page that looks broken.
        <p className="rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-4 py-8 text-center text-[13px] text-neutral-strong">
          {t("noSegments")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {review.segments.map((seg) => {
            const isOn = selected.has(seg.segmentId);
            return (
              <li
                key={seg.segmentId}
                className={`${styles.plate} rounded-[8px] border bg-surface-elevated p-4 ${
                  isOn ? "border-border-strong" : "border-border opacity-60"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={busy || decided}
                      onChange={() => toggle(seg.segmentId)}
                      className="size-4 accent-ink-display"
                    />
                    <span className="font-mono">{seg.segmentId}</span>
                  </label>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-neutral-strong">
                    <Camera size={12} strokeWidth={1.75} aria-hidden="true" />
                    {t("cameraObserved")}
                  </span>
                </div>

                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {LENS_ORDER.map((lens) => {
                    const v = seg.scores[lens];
                    return (
                      <li
                        key={lens}
                        className="rounded-[4px] border border-border bg-surface-sunken px-2 py-1.5"
                      >
                        <p className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
                          {tl(`${lens}.name`)}
                        </p>
                        <p className="font-mono text-[13px] font-medium text-ink">
                          {v === null || v === undefined ? (
                            <span className="text-neutral-strong">{t("unset")}</span>
                          ) : (
                            <>
                              {Math.round(v)}
                              <span className="text-neutral-strong">/100</span>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>

                <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  <div className="flex gap-1.5">
                    <dt className="text-neutral-strong">{t("confidenceLabel")}</dt>
                    <dd className="font-mono text-ink">
                      {pct(seg.confidence) === null ? t("unset") : `${pct(seg.confidence)}%`}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-neutral-strong">{t("coverageLabel")}</dt>
                    <dd className="font-mono text-ink">
                      {pct(seg.coverage) === null ? t("unset") : `${pct(seg.coverage)}%`}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-neutral-strong">{t("framesLabel")}</dt>
                    <dd className="font-mono text-ink">{seg.frames.length}</dd>
                  </div>
                  {seg.escalated > 0 ? (
                    <div className="flex gap-1.5">
                      <dt className="text-neutral-strong">{t("escalatedLabel")}</dt>
                      <dd className="font-mono text-ink">{seg.escalated}</dd>
                    </div>
                  ) : null}
                </dl>

                {Object.keys(seg.itemMedians).length > 0 ? (
                  <details className="mt-2.5">
                    <summary className="cursor-pointer text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                      {t("itemsHeading")}
                    </summary>
                    <ul className="mt-1.5 flex flex-col divide-y divide-border rounded-[4px] border border-border">
                      {Object.entries(seg.itemMedians).map(([key, m]) => (
                        <li key={key} className="flex items-baseline gap-2 px-2.5 py-1.5">
                          <span className="font-mono text-[11px] text-neutral-strong">{key}</span>
                          <span className="ml-auto font-mono text-[12px] text-ink">
                            {m.value === null ? t("unset") : m.value.toFixed(2)}
                          </span>
                          <span className="font-mono text-[10.5px] text-neutral-strong">
                            {t("itemFrames", { count: m.frames })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {seg.frames.length > 0 ? (
                  <div className="mt-2.5">
                    <h3 className="mb-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                      {t("filmstripHeading")}
                    </h3>
                    <ul className="flex gap-1.5 overflow-x-auto pb-1">
                      {seg.frames.map((f) => (
                        <li key={f.seq} className="shrink-0">
                          {f.url ? (
                            // Plain <img>: these are arbitrary Supabase bucket URLs
                            // and next/image would need every deployment host
                            // allowlisted. Lazy + fixed box so a 400-frame walk
                            // does not fetch a hundred megabytes on open.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={f.url}
                              alt={t("frameAlt", { seq: f.seq })}
                              loading="lazy"
                              decoding="async"
                              width={96}
                              height={72}
                              className="h-[72px] w-[96px] rounded-[4px] border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-[72px] w-[96px] items-center justify-center rounded-[4px] border border-dashed border-border-strong bg-surface-sunken">
                              <span className="font-mono text-[10px] text-neutral-strong">
                                {f.seq}
                              </span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!decided ? (
        <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-4`}>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("reasonLabel")}
            </span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              // 16px on phones prevents iOS focus auto-zoom; 13px returns at sm+.
              className="resize-y rounded-[4px] border border-border bg-surface-base px-3 py-2 text-[16px] text-ink outline-none transition-colors placeholder:text-neutral focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]"
            />
          </label>

          {error ? (
            <p role="alert" className="mt-2 text-[12px] font-medium text-clay">
              {error}
            </p>
          ) : null}

          <p className="mt-2 text-[12px] text-neutral-strong">
            {t("approveSummary", { count: selected.size, total: review.segments.length })}
          </p>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => submit("approve")}
              disabled={busy}
              className={`${styles.controlSoft} inline-flex items-center gap-1.5 rounded-[4px] bg-ink-display px-3 py-1.5 text-[12.5px] font-semibold text-surface hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated disabled:cursor-not-allowed disabled:opacity-55`}
            >
              <Check size={14} strokeWidth={2.25} aria-hidden="true" />
              {busy ? t("working") : t("approve")}
            </button>
            <button
              type="button"
              onClick={() => submit("reject")}
              disabled={busy}
              className={`${styles.control} inline-flex items-center gap-1.5 rounded-[4px] border border-clay/45 bg-clay/10 px-3 py-1.5 text-[12.5px] font-semibold text-clay hover:bg-clay/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay disabled:cursor-not-allowed disabled:opacity-55`}
            >
              <X size={14} strokeWidth={2.25} aria-hidden="true" />
              {busy ? t("working") : t("rejectSession")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
