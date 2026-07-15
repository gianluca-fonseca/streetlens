"use client";

import { useTranslations } from "next-intl";
import { ImageOff, Users, X } from "lucide-react";
import type { ScoreLayer, SegmentProperties } from "@/lib/segments";
import {
  parseCommunityReport,
  parseCommunityReports,
} from "@/lib/parse-feature-props";
import {
  LAYER_ORDER,
  RUBRIC_ITEMS,
  placeholderItemScore,
  sampleRamp,
  seedFromId,
} from "@/components/mapConfig";

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

  return (
    <section
      role="dialog"
      aria-label={segment.name}
      className="pointer-events-auto flex w-[min(21rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-[12px] border border-border bg-surface-elevated shadow-[var(--shadow-popover)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
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
          {isUnverified ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-1 text-[10.5px] font-medium text-neutral-strong">
              <Users size={12} strokeWidth={1.75} aria-hidden="true" />
              {t("communityPending")}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {isCommunity ? (
          <div className="mb-4 rounded-[8px] border border-dashed border-border-strong bg-surface-sunken p-3">
            <p className="text-[12px] leading-snug text-neutral-strong">
              {t("communityNote")}
            </p>
          </div>
        ) : null}

        {!isCommunity ? (
          <>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
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

        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
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

        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
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

        {reports.length > 0 ? (
          <div className={isCommunity ? "" : "mt-4"}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
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
        <footer className="border-t border-border bg-surface-sunken px-4 py-2.5">
          <p className="text-[11px] leading-snug text-neutral-strong">
            {t("demoNote")}
          </p>
        </footer>
      ) : null}
    </section>
  );
}
