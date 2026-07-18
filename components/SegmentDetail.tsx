"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImageOff, Pencil, ScanLine, Users, X } from "lucide-react";
import type { ScoreLayer, SegmentProperties } from "@/lib/segments";
import {
  parseCommunityReport,
  parseCommunityReports,
  parseCvObservations,
} from "@/lib/parse-feature-props";
import { formatProvenanceDate } from "@/lib/cv-provenance";
import {
  LAYER_ORDER,
  RUBRIC_ITEMS,
  placeholderItemScore,
  sampleRamp,
  seedFromId,
} from "@/components/mapConfig";
import styles from "@/components/ui/zen.module.css";

/**
 * Placeholder for a value the camera never established. Deliberately not "0":
 * a 0 would claim the camera looked and saw a failing street, when in fact no
 * frame supported that lens at all.
 */
const UNSET = "—";

/** 0-1 ratio → whole percent. Non-numeric/non-finite reads as unset, not 0%. */
function asPercent(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : null;
}

/**
 * The overall assessment sentence off a CV observation, or null. Defensive by
 * design: `assessment` crosses the maplibre property boundary and may arrive as a
 * string, a malformed object, or absent, so a bad shape must degrade to "no
 * assessment", never throw under the popover (which has no error boundary).
 */
function cvOverall(assessment: unknown): string | null {
  let a: unknown = assessment;
  if (typeof a === "string") {
    const s = a.trim();
    if (!s || s === "null") return null;
    try {
      a = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const overall = (a as { overall?: unknown }).overall;
  return typeof overall === "string" && overall.trim() ? overall : null;
}

/**
 * Elevated detail panel shown when a segment is selected (popover elevation).
 * Per-layer scores, a per-item rubric breakdown for the active layer, and a
 * photo placeholder grid. Built from the clicked feature's props — no fetch.
 */
export default function SegmentDetail({
  segment,
  activeLayer,
  onClose,
}: Readonly<{
  segment: SegmentProperties;
  activeLayer: ScoreLayer;
  onClose: () => void;
}>) {
  const t = useTranslations("detail");
  const tl = useTranslations("layers");
  const tr = useTranslations("rubric");
  const locale = useLocale();

  // Mobile bottom-sheet drag-to-dismiss. Attached only to the drag handle (which
  // is `md:hidden`), so the desktop popover is never draggable. A downward drag
  // past the threshold dismisses; anything short snaps back.
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ startY: number; active: boolean }>({
    startY: 0,
    active: false,
  });
  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    setDragY(Math.max(0, e.clientY - dragRef.current.startY));
  };
  const onDragEnd = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (dragY > 88) onClose();
    setDragY(0);
  };

  const scores: Record<ScoreLayer, number> = {
    overall: segment.score_overall,
    accessibility: segment.score_accessibility,
    drainage: segment.score_drainage,
    shade: segment.score_shade,
    bike: segment.score_bike,
  };
  const seed = seedFromId(segment.id);
  const items = RUBRIC_ITEMS[activeLayer].map((key, i) => ({
    key,
    score: placeholderItemScore(scores[activeLayer], seed, i),
  }));

  // Community/import segments carry no rubric scores — show provenance + reports
  // instead of a (fabricated-looking) 0-score breakdown (contract v3, ruling 1).
  const isCommunity =
    segment.source === "community" || segment.source === "import";
  const isUnverified = segment.verified === false;
  // Coerce defensively regardless of upstream: maplibre may deliver these as
  // JSON strings, and malformed report data must NEVER throw here (the panel has
  // no error boundary below the page). parse* tolerate string/object/null/junk.
  const embedded = parseCommunityReport(segment.community_report);
  const allReports = [
    ...(embedded ? [embedded] : []),
    ...parseCommunityReports(segment.community_reports),
  ];
  const reportMap = new Map<string, (typeof allReports)[number]>();
  for (const r of allReports) reportMap.set(r.id, r);
  const reports = [...reportMap.values()];

  // Approved camera observations. A proposal an admin accepted, NOT an audit:
  // rendered in the provisional idiom, never mixed into `scores` above
  // (docs/cv-funnel.md — "CV output is a proposal, not data").
  const cvObservations = parseCvObservations(segment.cv_observations);
  const hasCv = cvObservations.length > 0;
  // A reviewer corrected at least one of these readings before approving (u2). Shown
  // as a small, honest marker beside the CV chip — not loud, but not hidden.
  const hasHumanCorrected = cvObservations.some((o) => o.human_corrected);

  return (
    <section
      role="dialog"
      aria-label={segment.name}
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      className={[
        // Phone: SOLID bottom sheet (edge-anchored, reads better solid — dossier
        // §4 z-layering). Desktop: Recipe A glass popover floating over tiles,
        // applied ≥768px only via the module's media-gated class.
        "pointer-events-auto flex flex-col overflow-hidden border border-border bg-surface-elevated shadow-[var(--shadow-popover)]",
        styles.glassPanelDesktop,
        styles.enter,
        // Mobile: full-width bottom sheet flush to the bottom edge.
        "w-full max-h-[72dvh] rounded-t-[16px] border-b-0",
        // Desktop (sealed): the top-right popover, exactly as before.
        "md:w-[min(21rem,calc(100vw-1.5rem))] md:max-h-[calc(100dvh-8rem)] md:rounded-[12px] md:border-b",
        dragY ? "" : "transition-transform",
      ].join(" ")}
    >
      {/* Drag handle — bottom-sheet affordance, mobile only. */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="flex shrink-0 cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing md:hidden"
        aria-hidden="true"
      >
        <span className="h-1 w-10 rounded-full bg-border-strong" />
      </div>

      <header className="flex items-start justify-between gap-3 border-b border-border px-4 pb-4 pt-0 md:pt-4">
        <div className="min-w-0">
          <h2 className="font-display text-[1.05rem] font-semibold leading-tight text-ink">
            {segment.name}
          </h2>
          <p className="mt-0.5 text-[12px] text-neutral-strong">
            {segment.district}
            {!isCommunity && segment.audited_at ? (
              <>
                <span className="mx-1.5 text-neutral-strong">·</span>
                <span className="font-mono">
                  {t("auditedLabel")} {segment.audited_at}
                </span>
              </>
            ) : null}
          </p>
          {isUnverified || hasCv ? (
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              {isUnverified ? (
                <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-1 text-[10.5px] font-medium text-neutral-strong">
                  <Users size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("communityPending")}
                </span>
              ) : null}
              {hasCv ? (
                <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-1 text-[10.5px] font-medium text-neutral-strong">
                  <ScanLine size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("cvChip")}
                </span>
              ) : null}
              {hasHumanCorrected ? (
                <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-1 text-[10.5px] font-medium text-neutral-strong">
                  <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("cvHumanCorrected")}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4">
        {isCommunity ? (
          <div className="mb-4 rounded-[8px] border border-dashed border-border-strong bg-surface-sunken p-3">
            <p className="text-[12px] leading-snug text-neutral-strong">
              {t("communityNote")}
            </p>
          </div>
        ) : null}

        {!isCommunity ? (
          <>
        <h3 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("scoresHeading")}
        </h3>
        <ul className="mb-4 grid grid-cols-2 gap-2">
          {LAYER_ORDER.map((layer) => {
            const isActive = layer === activeLayer;
            return (
              <li
                key={layer}
                className={[
                  "flex items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2",
                  isActive
                    ? "border-border-strong bg-surface-sunken"
                    : "border-border bg-surface-elevated",
                ].join(" ")}
              >
                <span className="truncate text-[12px] text-ink">
                  {tl(`${layer}.name`)}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium text-ink"
                  title={tl(`${layer}.short`)}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: sampleRamp(layer, scores[layer]) }}
                  />
                  {scores[layer]}
                </span>
              </li>
            );
          })}
        </ul>

        <h3 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("breakdownHeading")}
          <span className="ml-1.5 font-sans font-normal normal-case tracking-normal text-neutral-strong">
            · {tl(`${activeLayer}.name`)}
          </span>
        </h3>
        <ul className="mb-4 flex flex-col divide-y divide-border rounded-[8px] border border-border">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-[12.5px] text-ink">
                {tr(
                  `${activeLayer}.${item.key}` as Parameters<typeof tr>[0],
                )}
              </span>
              <span className="font-mono text-[12.5px] font-medium text-neutral-strong">
                {item.score}
                <span className="text-neutral-strong">/100</span>
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("photosHeading")}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-1 text-center"
            >
              <ImageOff
                size={18}
                strokeWidth={1.75}
                className="text-neutral"
                aria-hidden="true"
              />
              <span className="text-[9.5px] leading-tight text-neutral-strong">
                {t("photoPlaceholder")}
              </span>
            </div>
          ))}
        </div>
          </>
        ) : null}

        {hasCv ? (
          <div className={isCommunity ? "" : "mt-4"}>
            <h3 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("cvHeading")}
            </h3>
            <p className="mb-2 text-[12px] leading-snug text-neutral-strong">
              {t("cvNote")}
            </p>
            <ul className="flex flex-col divide-y divide-border rounded-[8px] border border-border">
              {cvObservations.map((o) => {
                const frames = Array.isArray(o.frame_refs)
                  ? o.frame_refs.length
                  : 0;
                const confidence = asPercent(o.confidence);
                const coverage = asPercent(o.coverage);
                // Provenance the segment must answer at a glance (u-provenance):
                // when it was walked and when the reading last changed (created_at
                // moves on re-approval upsert, so it reads "last updated"). Both
                // cross the maplibre boundary; the helper never throws. The
                // contributor's contact is PII and is NEVER shown publicly (conductor
                // privacy rule) — the public attribution is a generic "Community
                // contributor"; contact lives only on the admin workbench.
                const walked = formatProvenanceDate(o.captured_on, locale);
                const updated = formatProvenanceDate(o.created_at, locale);
                return (
                  <li key={o.id} className="px-3 py-2">
                    <p className="font-mono text-[10.5px] text-neutral-strong">
                      {t("cvObservationLabel")}
                    </p>
                    {/* Compact provenance: dates as friendly localized text (EN/ES),
                        contact shown as given or an "Anonymous contributor" fallback,
                        never the ip hash and never a mailto. */}
                    <dl className="mt-1 flex flex-col gap-0.5 text-[11px] leading-snug text-neutral-strong">
                      {walked ? (
                        <div className="flex flex-wrap gap-x-1.5">
                          <dt>{t("cvWalkedLabel")}</dt>
                          <dd className="text-ink">{walked}</dd>
                        </div>
                      ) : null}
                      {updated ? (
                        <div className="flex flex-wrap gap-x-1.5">
                          <dt>{t("cvUpdatedLabel")}</dt>
                          <dd className="text-ink">{updated}</dd>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-x-1.5">
                        <dt>{t("cvSubmittedByLabel")}</dt>
                        <dd className="text-ink">{t("cvSubmittedCommunity")}</dd>
                      </div>
                    </dl>
                    {/* Observed lens values. Mono numerals, no ramp dots: the
                        ramp is reserved for audited data, and these are not it. */}
                    <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                      {LAYER_ORDER.map((layer) => {
                        const observed = o.scores[layer];
                        const known = typeof observed === "number";
                        return (
                          <li
                            key={layer}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate text-[12.5px] leading-snug text-ink">
                              {tl(`${layer}.name`)}
                            </span>
                            <span
                              className="font-mono text-[12.5px] font-medium text-neutral-strong"
                              title={known ? undefined : t("cvUnknown")}
                            >
                              {known ? observed : UNSET}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1.5 font-mono text-[10.5px] text-neutral-strong">
                      {t("cvConfidenceLabel")} {confidence ?? UNSET}
                      <span className="mx-1.5">·</span>
                      {t("cvCoverageLabel")} {coverage ?? UNSET}
                      <span className="mx-1.5">·</span>
                      {/* Label + count rather than an ICU plural: this codebase
                          has no plural/select syntax anywhere and branches
                          plurals in TS (see admin.queue's subtitleZero/One/Many).
                          A label sidesteps the grammatical number entirely. */}
                      {t("cvFramesLabel")} {frames}
                    </p>
                    {/* The reviewer-approved synthesis (u2). Model output, in English:
                        the localized labels frame it, the sentence itself is the
                        model's. Numbers above are still the reviewer's; this is
                        context. Read defensively — it crosses the maplibre boundary. */}
                    {cvOverall(o.assessment) ? (
                      <div className="mt-1.5 rounded-[6px] border border-dashed border-border-strong bg-surface-sunken px-2.5 py-1.5">
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-strong">
                          {t("cvAssessmentLabel")}
                        </p>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink">
                          {cvOverall(o.assessment)}
                        </p>
                        <p className="mt-1 text-[9.5px] leading-snug text-neutral-strong">
                          {t("cvAssessmentNote")}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {reports.length > 0 ? (
          <div className={isCommunity && !hasCv ? "" : "mt-4"}>
            <h3 className="mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("communityReportsHeading")}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-[8px] border border-border">
              {reports.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <p className="font-mono text-[10.5px] text-neutral-strong">
                    {t("communityReportLabel")}
                    {typeof r.created_at === "string" && r.created_at
                      ? ` · ${r.created_at.slice(0, 10)}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-ink">
                    {r.note}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {!isCommunity ? (
        <footer className="border-t border-border bg-surface-sunken px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:pb-2.5">
          <p className="text-[11px] leading-snug text-neutral-strong">
            {t("demoNote")}
          </p>
        </footer>
      ) : null}
    </section>
  );
}
