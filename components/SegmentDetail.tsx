"use client";

import { useRef, useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ImageOff, Pencil, ScanLine, Users, X } from "lucide-react";
import type { ScoreLayer, SegmentProperties } from "@/lib/segments";
import type { CvObservation } from "@/lib/types";
import {
  parseCommunityReport,
  parseCommunityReports,
  parseCvObservations,
} from "@/lib/parse-feature-props";
import { formatProvenanceDate, splitCvObservations, cvOverallAssessment } from "@/lib/cv-provenance";
import {
  LAYER_ORDER,
  RUBRIC_ITEMS,
  placeholderItemScore,
  seedFromId,
} from "@/components/mapConfig";
import { meterWidth, rampInkVars } from "@/components/scoreColor";
import styles from "@/components/ui/zen.module.css";
import panel from "@/components/ui/panel.module.css";
import StreetShareActions from "@/components/street/StreetShareActions";

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
 * The same defensive read as asPercent, but keeping the raw 0-1 ratio so the
 * confidence/coverage gauges can size themselves. Clamped, because these cross
 * the maplibre property boundary and a 1.4 would overflow its track.
 */
function asRatio(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

/**
 * The overall assessment sentence off a CV observation, or null. Defensive by
 * design: `assessment` crosses the maplibre property boundary and may arrive as a
 * string, a malformed object, or absent, so a bad shape must degrade to "no
 * assessment", never throw under the popover (which has no error boundary).
 */
function cvOverall(assessment: unknown): string | null {
  return cvOverallAssessment(assessment);
}

/**
 * Ramp ink as CSS custom properties, typed for the `style` prop. React's
 * CSSProperties has no slot for custom properties, and this cast is the
 * standard escape hatch — the object is generated, never hand-written, so a
 * typo cannot reach here.
 */
function inkStyle(layer: ScoreLayer, value: number): React.CSSProperties {
  return rampInkVars(layer, value) as React.CSSProperties;
}

/**
 * Stagger offset for the panel's settle-in. Each block arrives a beat after the
 * one above it, so the eye is walked down the panel instead of being handed all
 * of it at once. Offsets stay small and the last one is 180ms, well inside the
 * window where a stagger still reads as one gesture rather than a queue.
 *
 * Delay only — every block's own animation is var(--dur-base) and no block
 * moves more than 6px, so nothing here can be mistaken for the panel loading.
 */
function settleDelay(ms: number): React.CSSProperties {
  return { "--sd-delay": `${ms}ms` } as React.CSSProperties;
}

/**
 * The magnitude bar under a score. Purely decorative in the a11y tree: the
 * number beside it already says everything the bar says, so announcing it
 * again would only make a screen reader read every lens twice.
 *
 * A lens the camera never established gets an empty dashed track rather than a
 * zero-width fill — same reasoning as the "—" numeral (UNSET). A 0%-wide bar
 * would look exactly like a street that scored 0, which is a claim no frame
 * ever supported.
 */
function Meter({ value }: Readonly<{ value: number | null }>) {
  if (value === null) {
    return <div className={`mt-1.5 ${panel.meterUnset}`} aria-hidden="true" />;
  }
  return (
    <div className={`mt-1.5 ${panel.meterTrack}`} aria-hidden="true">
      <span className={panel.meterFill} style={{ width: meterWidth(value) }} />
    </div>
  );
}

/**
 * Confidence / coverage indicator. Neutral ink on purpose: these describe how
 * well the camera SAW the street, not how good the street is, so borrowing a
 * score ramp here would assert a quality the number does not carry.
 *
 * `ratio` is the raw 0–1 value; `label` and the formatted percent stay visible
 * beside it, so the meter adds a shape without removing a readable figure.
 */
function Gauge({
  label,
  ratio,
  text,
}: Readonly<{ label: string; ratio: number | null; text: string }>) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-baseline justify-between gap-1.5 font-mono text-[10.5px] text-neutral-strong">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-ink">{text}</span>
      </p>
      <div className={`mt-1 ${panel.meterTrack}`} aria-hidden="true">
        {ratio === null ? null : (
          <span
            className={panel.gaugeFill}
            style={{ width: meterWidth(ratio * 100) }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One approved camera observation, rendered identically whether it is the
 * canonical reading or an archived one (u32) — same card treatment, so the
 * archive reads as history rather than a lesser second-class thing.
 *
 * `superseded` changes only the framing: the label says which kind it is, and
 * an archived card carries a "Superseded" tag plus its walk date up in the
 * label line, since for a past reading WHEN it was walked is the whole point.
 */
function CvObservationCard({
  observation: o,
  superseded,
}: Readonly<{ observation: CvObservation; superseded: boolean }>) {
  const t = useTranslations("detail");
  const tl = useTranslations("layers");
  const locale = useLocale();

  const frames =
    "frame_count" in o && typeof (o as { frame_count?: unknown }).frame_count === "number"
      ? (o as { frame_count: number }).frame_count
      : Array.isArray(o.frame_refs)
        ? o.frame_refs.length
        : 0;
  const confidence = asPercent(o.confidence);
  const coverage = asPercent(o.coverage);
  const confidenceRatio = asRatio(o.confidence);
  const coverageRatio = asRatio(o.coverage);
  // Provenance the segment must answer at a glance (u-provenance): when it was
  // walked and when the reading last changed (created_at moves on re-approval
  // upsert, so it reads "last updated"). Both cross the maplibre boundary; the
  // helper never throws. The contributor's contact is PII and is NEVER shown
  // publicly (conductor privacy rule) — the public attribution is a generic
  // "Community contributor"; contact lives only on the admin workbench.
  const walked = formatProvenanceDate(o.captured_on, locale);
  const updated = formatProvenanceDate(o.created_at, locale);

  return (
    <li
      className={[
        "px-3 py-2",
        // Only the canonical card carries the CV accent. The archive stays
        // plain on purpose: the tint is the visual argument for which reading
        // is the street's present state, so spending it on history would say
        // the opposite of what u32 established.
        superseded ? "" : panel.cvCanonical,
      ].join(" ")}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-neutral-strong">
        <span>{superseded ? t("cvObservationLabel") : t("cvCurrentLabel")}</span>
        {superseded ? (
          <>
            {walked ? (
              <span className="text-ink">· {walked}</span>
            ) : null}
            <span className="rounded-[3px] border border-dashed border-border-strong bg-surface-sunken px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em]">
              {t("cvSuperseded")}
            </span>
          </>
        ) : null}
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
      {/* Observed lens values, in the map's colour language (u33). Each value
          takes its lens ramp ink and a filled meter, so an 87.5 towers over a
          16.67 at a glance instead of being one more digit in a column.

          This supersedes the earlier "no ramp colour on CV cards" rule, which
          existed to stop a camera proposal from LOOKING like an audit. That
          separation is now carried by everything around the number — the
          provisional chip, the "not yet field-audited" heading note, the
          section's own accent family — rather than by withholding colour, and
          withholding it cost the panel the one encoding that makes five scores
          comparable at a glance. The ramp itself is untouched and unmoved:
          scoreColor.ts only fits its luminance to the panel surface. */}
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {LAYER_ORDER.map((layer) => {
          const observed = o.scores[layer];
          const known = typeof observed === "number";
          return (
            <li key={layer} style={known ? inkStyle(layer, observed) : undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] leading-snug text-ink">
                  {tl(`${layer}.name`)}
                </span>
                <span
                  className={[
                    "font-mono text-[12.5px] font-semibold",
                    known ? panel.scoreInk : "text-neutral-strong",
                  ].join(" ")}
                  title={known ? undefined : t("cvUnknown")}
                >
                  {known ? observed : UNSET}
                </span>
              </div>
              <Meter value={known ? observed : null} />
            </li>
          );
        })}
      </ul>
      {/* Evidence quality as instruments rather than a run of prose (u33).
          Frames stays a bare count: it is a tally, not a proportion, so a
          0–100 track would have no honest full scale to fill against. */}
      {/* The two gauges get the row to themselves. Sharing it three ways left
          each label ~86px against the ~93px "Confidence 68%" needs, so the
          label truncated to "Confide…" — by two pixels in English, and Spanish
          has no more room to give. Frames drops to its own line instead: it is
          a bare tally rather than a proportion, so it was never going to carry
          a meter anyway and loses nothing by sitting apart. */}
      <div className="mt-2.5 flex items-start gap-3">
        <Gauge
          label={t("cvConfidenceLabel")}
          ratio={confidenceRatio}
          text={confidence ?? UNSET}
        />
        <Gauge
          label={t("cvCoverageLabel")}
          ratio={coverageRatio}
          text={coverage ?? UNSET}
        />
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] text-neutral-strong">
        {/* Label + count rather than an ICU plural: this codebase has no
            plural/select syntax anywhere and branches plurals in TS (see
            admin.queue's subtitleZero/One/Many). A label sidesteps the
            grammatical number entirely. */}
        {t("cvFramesLabel")} <span className="text-ink">{frames}</span>
      </p>
      {/* The reviewer-approved synthesis (u2). Model output, in English: the
          localized labels frame it, the sentence itself is the model's. Numbers
          above are still the reviewer's; this is context. Read defensively — it
          crosses the maplibre boundary. */}
      {cvOverall(o.assessment) ? (
        <div
          className={`mt-2.5 rounded-[6px] border border-border bg-surface-sunken px-2.5 py-1.5 ${panel.assessment}`}
        >
          {/* Accent on the frame and the label only. The sentence itself stays
              plain ink: this is the one block on the panel meant to be READ as
              prose, and colouring body text would slow that down for style. */}
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.1em] ${panel.assessmentLabel}`}
          >
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
}

/**
 * Elevated detail panel shown when a segment is selected (popover elevation).
 * Per-layer scores, a per-item rubric breakdown for the active layer, and a
 * photo placeholder grid. Paint props come from the clicked feature; community
 * reports and CV observations load on click via /api/segments/[id]/detail.
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

  const [detailLoading, setDetailLoading] = useState(true);
  const [detailCv, setDetailCv] = useState<CvObservation[] | null>(null);
  const [detailReports, setDetailReports] = useState<
    ReturnType<typeof parseCommunityReports> | null
  >(null);
  const [detailEmbedded, setDetailEmbedded] = useState<
    ReturnType<typeof parseCommunityReport> | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/segments/${encodeURIComponent(segment.id)}/detail`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          community_report?: unknown;
          community_reports?: unknown;
          cv_observations?: unknown;
        };
        if (cancelled) return;
        setDetailEmbedded(parseCommunityReport(data.community_report));
        setDetailReports(parseCommunityReports(data.community_reports));
        setDetailCv(parseCvObservations(data.cv_observations) as CvObservation[]);
      } catch {
        /* degrade to paint-only props */
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [segment.id]);

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
  const embedded = detailEmbedded ?? parseCommunityReport(segment.community_report);
  const allReports = [
    ...(embedded ? [embedded] : []),
    ...(detailReports ?? parseCommunityReports(segment.community_reports)),
  ];
  const reportMap = new Map<string, (typeof allReports)[number]>();
  for (const r of allReports) reportMap.set(r.id, r);
  const reports = [...reportMap.values()];

  // Approved camera observations. A proposal an admin accepted, NOT an audit:
  // rendered in the provisional idiom, never mixed into `scores` above
  // (docs/cv-funnel.md — "CV output is a proposal, not data").
  const cvObservations =
    detailCv ?? parseCvObservations(segment.cv_observations);
  // ONE observation is the segment's present-day state: the most recently walked
  // one (u32, issue #19). Everything it supersedes moves to the archive
  // disclosure below. The ordering lives in lib/cv-provenance so this panel and
  // any future surface cannot drift into disagreeing about what the street is.
  const { canonical, archived } = splitCvObservations(cvObservations);
  const hasCv =
    canonical !== null || (segment.cv_count ?? 0) > 0 || cvObservations.length > 0;
  // A reviewer corrected the CURRENT reading before approving it (u2). Shown as a
  // small, honest marker beside the CV chip — not loud, but not hidden. Scoped to
  // the canonical observation on purpose: the chips describe the street as it
  // stands now, so a correction on a superseded reading must not still flag it.
  const hasHumanCorrected = canonical?.human_corrected === true;
  const [archiveOpen, setArchiveOpen] = useState(false);

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
        // Dark elevation scope (u34). Re-values the surface/hairline/accent
        // tokens for this subtree only, so the panel reads as a lit object with
        // depth instead of a void with seams. Must sit on the root, above every
        // `bg-surface-*` utility inside — see panel.module.css.
        panel.panelScope,
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
              {/* Three chips, three registers (u33). These used to be identical
                  grey pills, which meant the panel's most load-bearing fact —
                  what KIND of evidence stands behind this segment — was carried
                  entirely by reading the words. Camera evidence takes the map's
                  flash-pink CV accent, an unverified community claim takes
                  amber, and a reviewer correction stays neutral because it is a
                  footnote on the camera chip rather than a third provenance.
                  Every chip keeps its icon and its full label: colour is added
                  as a second channel here, never as the only one. */}
              {isUnverified ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-[4px] border border-dashed px-2 py-1 text-[10.5px] font-medium ${panel.chip} ${panel.chipCommunity}`}
                >
                  <Users size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("communityPending")}
                </span>
              ) : null}
              {hasCv ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[10.5px] font-medium ${panel.chip} ${panel.chipCv}`}
                >
                  <ScanLine size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("cvChip")}
                </span>
              ) : null}
              {hasHumanCorrected ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-[4px] border border-dashed px-2 py-1 text-[10.5px] font-medium ${panel.chip} ${panel.chipCorrected}`}
                >
                  <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                  {t("cvHumanCorrected")}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StreetShareActions segmentId={segment.id} variant="panel" />
          <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="shrink-0 rounded-[4px] border border-border p-1.5 text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        </div>
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
        <h3
          style={settleDelay(0)}
          className={`mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong ${panel.settle}`}
        >
          {t("scoresHeading")}
        </h3>
        <ul style={settleDelay(0)} className={`mb-4 grid grid-cols-2 gap-2 ${panel.settle}`}>
          {LAYER_ORDER.map((layer) => {
            const isActive = layer === activeLayer;
            return (
              <li
                key={layer}
                style={inkStyle(layer, scores[layer])}
                className={[
                  "rounded-[8px] border px-2.5 py-2",
                  isActive
                    ? "border-border-strong bg-surface-sunken"
                    : "border-border bg-surface-elevated",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] text-ink">
                    {tl(`${layer}.name`)}
                  </span>
                  {/* The ramp dot this replaces encoded the same thing in ~10px
                      of area. The meter below says it at full width and adds
                      magnitude, so keeping both would be one idea drawn twice. */}
                  <span
                    className={`font-mono text-[13px] font-semibold ${panel.scoreInk}`}
                    title={tl(`${layer}.short`)}
                  >
                    {scores[layer]}
                  </span>
                </div>
                <Meter value={scores[layer]} />
              </li>
            );
          })}
        </ul>

        <h3
          style={settleDelay(60)}
          className={`mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong ${panel.settle}`}
        >
          {t("breakdownHeading")}
          <span className="ml-1.5 font-sans font-normal normal-case tracking-normal text-neutral-strong">
            · {tl(`${activeLayer}.name`)}
          </span>
        </h3>
        <ul
          style={settleDelay(60)}
          className={`mb-4 flex flex-col divide-y divide-border rounded-[8px] border border-border ${panel.settle}`}
        >
          {items.map((item) => (
            // Rubric items are components OF the active layer, so they take
            // that layer's ramp — a drainage item is read against the drainage
            // scale, not a scale of its own. The "/100" stays neutral: it is
            // the denominator, not a value, and colouring it would imply the
            // maximum somehow scores too.
            <li
              key={item.key}
              style={inkStyle(activeLayer, item.score)}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-[12.5px] text-ink">
                {tr(
                  `${activeLayer}.${item.key}` as Parameters<typeof tr>[0],
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`${panel.meterTrack} w-12`}
                >
                  <span
                    className={panel.meterFill}
                    style={{ width: meterWidth(item.score) }}
                  />
                </span>
                <span
                  className={`font-mono text-[12.5px] font-semibold ${panel.scoreInk}`}
                >
                  {item.score}
                  <span className="font-medium text-neutral-strong">/100</span>
                </span>
              </span>
            </li>
          ))}
        </ul>

        <h3
          style={settleDelay(120)}
          className={`mb-2 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong ${panel.settle}`}
        >
          {t("photosHeading")}
        </h3>
        <div style={settleDelay(120)} className={`grid grid-cols-3 gap-2 ${panel.settle}`}>
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
          <div
            style={settleDelay(120)}
            className={`${isCommunity ? "" : "mt-4"} ${panel.cvSection} ${panel.settle}`}
          >
            <h3
              className={`mb-2 flex items-center text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong ${panel.cvHeadingTick}`}
            >
              {t("cvHeading")}
            </h3>
            <p className="mb-2 text-[12px] leading-snug text-neutral-strong">
              {t("cvNote")}
            </p>
            {detailLoading && !canonical ? (
              <p className="rounded-[8px] border border-border bg-surface-sunken px-3 py-4 text-center text-[12px] text-neutral-strong">
                …
              </p>
            ) : canonical ? (
            <ul className="flex flex-col divide-y divide-border rounded-[8px] border border-border">
              <CvObservationCard observation={canonical} superseded={false} />
            </ul>
            ) : null}

            {/* Archive. Only rendered when something was actually superseded:
                with zero or one observation there is no history to disclose, and
                an empty "Archive (0)" toggle would be pure noise. Collapsed by
                default — the current reading is the answer, the archive is for
                someone who asks a follow-up question. Nothing is deleted; this
                is a display split only. */}
            {archived.length > 0 ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setArchiveOpen((open) => !open)}
                  aria-expanded={archiveOpen}
                  aria-controls="cv-archive"
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-3 py-2 text-left text-[11px] font-medium text-neutral-strong transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <span className="font-mono uppercase tracking-[0.12em]">
                    {t("cvArchiveToggle")}
                    {/* Count outside the message: this codebase branches plurals
                        in TS rather than using ICU plural syntax, and a bare
                        parenthesized number sidesteps grammatical number in both
                        locales. */}
                    <span className="ml-1.5">({archived.length})</span>
                  </span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={[
                      "shrink-0 transition-transform",
                      archiveOpen ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>
                {archiveOpen ? (
                  // Settles in on disclosure. The close is instant by design:
                  // animating it would mean keeping the archived cards mounted
                  // through the collapse, and their text is asserted absent
                  // while closed by scripts/verify-u30-review-loop.mjs — a
                  // rendered-but-shrinking card would still count as visible
                  // text and quietly break that guarantee. A disclosure that
                  // arrives softly and leaves immediately is the honest trade.
                  <ul
                    id="cv-archive"
                    className={`mt-2 flex flex-col divide-y divide-border rounded-[8px] border border-border ${panel.settle}`}
                  >
                    {archived.map((o) => (
                      <CvObservationCard
                        key={o.id}
                        observation={o}
                        superseded={true}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {reports.length > 0 ? (
          <div
            style={settleDelay(180)}
            className={`${isCommunity && !hasCv ? "" : "mt-4"} ${panel.settle}`}
          >
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
