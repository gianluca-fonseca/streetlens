"use client";

/**
 * Reviewing one camera walk (u30, extended in u2).
 *
 * The judgement is PER SEGMENT. Every segment starts ticked (the common case is
 * "the walk is fine"), and the admin unticks what the camera got wrong. Approving
 * publishes exactly the ticked set and retracts the rest.
 *
 * u2 makes the review a workbench, not just a verdict. The reviewer can open any
 * frame (FrameInspector) to see and CORRECT the model's readings, exclude or delete
 * frames, and hand-edit a segment's final lens scores. Every change flows through
 * ONE recompute (lib/capture/review-overrides.ts) that reuses the real rollup math,
 * so the numbers on screen are exactly the numbers that will land — the segment
 * cards are derived from that recompute, never from the server's cached rollups.
 *
 * Nothing here is presented as an audit. A null lens is UNKNOWN and renders as
 * "unset", never as a zero.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Camera, Check, FlaskConical, Maximize2, Pencil, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";
import type { ReviewFrame, SessionReview, SegmentAssessment } from "@/lib/capture/review-store";
import {
  recomputeReview,
  type ReviewCorrections,
  type RecomputedSegment,
} from "@/lib/capture/review-overrides";
import { LENS_KEYS, type LensKey } from "@/lib/capture/scoring";
import { formatProvenanceDate, sanitizeContact } from "@/lib/cv-provenance";
import type { RubricItemKey } from "@/lib/capture/types";
import FrameInspector from "./FrameInspector";
import FrameLightbox from "./FrameLightbox";
import ReviewMap, { type MatchedGeometry } from "./ReviewMap";
import ReplayPlayer, { ReplayButton, useReplay } from "./SessionReplay";
import ExpandedMap from "./ExpandedMap";
import styles from "@/components/ui/zen.module.css";

const LENS_ORDER = LENS_KEYS;

/** 0-1 → a whole percent. Null stays null: unknown is not zero. */
function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

/** A fresh, independent corrections record (never share the frozen EMPTY one). */
function freshCorrections(): ReviewCorrections {
  return { itemOverrides: {}, excluded: [], deleted: [], manualScores: {}, baselineLenses: {} };
}

export default function CaptureReview({
  review,
  matchedGeometry = [],
}: Readonly<{ review: SessionReview; matchedGeometry?: MatchedGeometry[] }>) {
  const t = useTranslations("admin.capture");
  const tl = useTranslations("layers");
  const locale = useLocale();
  const router = useRouter();

  const [corrections, setCorrections] = useState<ReviewCorrections>(freshCorrections);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [lightboxSeq, setLightboxSeq] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Session replay (u3). Lifted here so the SAME playback drives both the
  // frame-first player and the expanded map, and so the map's current-frame
  // highlight rides the existing selection sync instead of a forked one.
  const replay = useReplay();
  const [mapExpanded, setMapExpanded] = useState(false);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const numFmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const decided = review.status === "approved" || review.status === "rejected";

  // The live recompute the reviewer's corrections produce, from the frames via the
  // real rollup math, with the synthesis adjustments applied (seal #2). Each segment
  // carries its own pure baseline (`baselineScores`) and adjusted proposal
  // (`adjustedScores`) for the side-by-side, so no second recompute is needed.
  const result = useMemo(
    () => recomputeReview(review.frames, corrections, review.assessments),
    [review.frames, corrections, review.assessments],
  );

  const survivingById = useMemo(
    () => new Map(result.segments.map((s) => [s.segmentId, s])),
    [result],
  );
  const droppedIds = useMemo(() => new Set(result.droppedSegmentIds), [result]);

  // Segments to show: every one that ever had a frame, in a stable order.
  const segmentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of review.frames) if (f.segmentId) ids.add(f.segmentId);
    return [...ids].sort((a, b) => a.localeCompare(b));
  }, [review.frames]);

  const framesBySegment = useMemo(() => {
    const map = new Map<string, ReviewFrame[]>();
    for (const f of review.frames) {
      if (!f.segmentId) continue;
      const list = map.get(f.segmentId);
      if (list) list.push(f);
      else map.set(f.segmentId, [f]);
    }
    return map;
  }, [review.frames]);

  const unmatchedFrames = useMemo(
    () => review.frames.filter((f) => !f.segmentId),
    [review.frames],
  );

  // Every segment starts ticked; a dropped one is filtered out at approve time.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(segmentIds));

  const excludedSet = useMemo(() => new Set(corrections.excluded), [corrections]);
  const deletedSet = useMemo(() => new Set(corrections.deleted), [corrections]);

  const selectedFrame = useMemo(
    () => (selectedSeq === null ? null : review.frames.find((f) => f.seq === selectedSeq) ?? null),
    [selectedSeq, review.frames],
  );
  const selectedSegmentId = selectedFrame?.segmentId ?? null;

  const hasMap =
    review.track.length > 0 || review.frames.some((f) => f.position !== null);

  const frameBySeq = useMemo(
    () => new Map(review.frames.map((f) => [f.seq, f])),
    [review.frames],
  );
  const replayFrame =
    replay.currentSeq === null ? null : frameBySeq.get(replay.currentSeq) ?? null;

  // During playback the map's highlight follows the playhead through the SAME
  // selection props manual selection uses; otherwise it follows the inspector.
  const mapSelectedSeq = replay.active ? replay.currentSeq : selectedSeq;
  const mapSelectedSegmentId = replay.active
    ? replayFrame?.segmentId ?? null
    : selectedSegmentId;

  function handleMapSelect(seq: number) {
    // A dot tap seeks the replay when one is running (two-way sync), else selects.
    if (replay.active) {
      replay.seekToSeq(seq);
      return;
    }
    setSelectedSeq((s) => (s === seq ? null : seq));
  }
  function startWholeReplay() {
    replay.start(review.frames.map((f) => f.seq));
  }
  function startSegmentReplay(segmentId: string) {
    replay.start((framesBySegment.get(segmentId) ?? []).map((f) => f.seq));
  }

  const inspectorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedSeq !== null) inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedSeq]);

  /* ---------------- correction mutators (immutable) ---------------- */

  function overrideItem(seq: number, key: RubricItemKey, value: number | null | undefined) {
    setCorrections((prev) => {
      const items = { ...prev.itemOverrides };
      const forSeq = { ...(items[seq] ?? {}) };
      if (value === undefined) delete forSeq[key];
      else forSeq[key] = value;
      if (Object.keys(forSeq).length === 0) delete items[seq];
      else items[seq] = forSeq;
      return { ...prev, itemOverrides: items };
    });
  }

  function toggleExclude(seq: number) {
    setCorrections((prev) => {
      const has = prev.excluded.includes(seq);
      return {
        ...prev,
        excluded: has ? prev.excluded.filter((s) => s !== seq) : [...prev.excluded, seq],
      };
    });
  }

  function setManualScore(segmentId: string, lens: LensKey, value: number | null | undefined) {
    setCorrections((prev) => {
      const scores = { ...prev.manualScores };
      const forSeg = { ...(scores[segmentId] ?? {}) };
      if (value === undefined) delete forSeg[lens];
      else forSeg[lens] = value;
      if (Object.keys(forSeg).length === 0) delete scores[segmentId];
      else scores[segmentId] = forSeg;
      return { ...prev, manualScores: scores };
    });
  }

  function resetSegment(segmentId: string) {
    const seqs = new Set((framesBySegment.get(segmentId) ?? []).map((f) => f.seq));
    setCorrections((prev) => {
      const items = { ...prev.itemOverrides };
      for (const seq of seqs) delete items[seq];
      const scores = { ...prev.manualScores };
      delete scores[segmentId];
      const baselineLenses = { ...prev.baselineLenses };
      delete baselineLenses[segmentId];
      return {
        ...prev,
        itemOverrides: items,
        excluded: prev.excluded.filter((s) => !seqs.has(s)),
        manualScores: scores,
        baselineLenses,
      };
    });
  }

  /** Toggle one lens between the synthesis-adjusted proposal (default) and the baseline. */
  function toggleBaselineLens(segmentId: string, lens: LensKey) {
    setCorrections((prev) => {
      const bl = { ...prev.baselineLenses };
      const cur = bl[segmentId] ?? [];
      const next = cur.includes(lens) ? cur.filter((l) => l !== lens) : [...cur, lens];
      if (next.length === 0) delete bl[segmentId];
      else bl[segmentId] = next;
      return { ...prev, baselineLenses: bl };
    });
  }

  /** Per segment: take the baseline for every adjusted lens, or (empty) revert to adjusted. */
  function setSegmentBaseline(segmentId: string, lenses: LensKey[]) {
    setCorrections((prev) => {
      const bl = { ...prev.baselineLenses };
      if (lenses.length === 0) delete bl[segmentId];
      else bl[segmentId] = [...lenses];
      return { ...prev, baselineLenses: bl };
    });
  }

  function resetFrame(seq: number) {
    setCorrections((prev) => {
      const items = { ...prev.itemOverrides };
      delete items[seq];
      return {
        ...prev,
        itemOverrides: items,
        excluded: prev.excluded.filter((s) => s !== seq),
      };
    });
  }

  async function deleteFrame(seq: number) {
    // Optimistic: a delete is irreversible, so mark it locally and drop it from
    // scoring at once, then make it real. Revert only if the request fails.
    setCorrections((prev) =>
      prev.deleted.includes(seq) ? prev : { ...prev, deleted: [...prev.deleted, seq] },
    );
    try {
      const res = await fetch("/api/admin/capture/frame", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: review.sessionId, seq }),
      });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setCorrections((prev) => ({ ...prev, deleted: prev.deleted.filter((s) => s !== seq) }));
      setError(t("deleteError"));
    }
  }

  function toggleApprove(segmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return next;
    });
  }

  const approvableSelected = useMemo(
    () => [...selected].filter((id) => survivingById.has(id)),
    [selected, survivingById],
  );

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
          segment_ids: action === "approve" ? approvableSelected : [],
          corrections,
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

  const totalCorrections =
    Object.keys(corrections.itemOverrides).length +
    corrections.excluded.length +
    corrections.deleted.length +
    Object.keys(corrections.manualScores).length +
    Object.keys(corrections.baselineLenses).length;

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
            <dd className="font-medium text-ink">
              {formatProvenanceDate(review.capturedOn, locale) ?? t("unset")}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-strong">{t("tokensLabel")}</dt>
            <dd className="font-mono font-medium text-ink">
              {numFmt.format(review.tokens.inputTokens + review.tokens.outputTokens)}
            </dd>
          </div>
          {/* The SAME "submitted by" fact the public popover shows, so reviewer and
              public read one truth. Contact only reaches here via the secret-gated
              detail RPC (0024); anonymous / fixture sessions fall back. Never a hash. */}
          <div className="col-span-2 sm:col-span-2">
            <dt className="text-neutral-strong">{t("submittedByLabel")}</dt>
            <dd className="break-words font-medium text-ink">
              {sanitizeContact(review.contact) ?? t("submittedAnonymous")}
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
          {totalCorrections > 0 ? (
            <li className="inline-flex items-center gap-1.5 rounded-[4px] border border-pine/45 bg-pine/10 px-2 py-0.5 text-[11px] font-medium text-pine">
              <Pencil size={12} strokeWidth={2} aria-hidden="true" />
              {t("correctionsMade", { count: totalCorrections })}
            </li>
          ) : null}
        </ul>
      </section>

      {hasMap ? (
        <section className={`${styles.plate} rounded-[8px] border border-border bg-surface-elevated p-3`}>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
              {t("mapHeading")}
            </h2>
            <button
              type="button"
              onClick={() => setMapExpanded(true)}
              aria-label={t("mapExpand")}
              data-map-expand
              className={`${styles.control} ml-auto inline-flex items-center gap-1.5 rounded-[4px] border border-border px-2 py-0.5 text-[11px] font-medium text-neutral-strong hover:text-ink`}
            >
              <Maximize2 size={12} strokeWidth={1.75} aria-hidden="true" />
              {t("mapExpand")}
            </button>
          </div>
          <ReviewMap
            track={review.track}
            frames={review.frames}
            matchedGeometry={matchedGeometry}
            excludedSeqs={corrections.excluded}
            deletedSeqs={corrections.deleted}
            selectedSeq={mapSelectedSeq}
            selectedSegmentId={mapSelectedSegmentId}
            onSelectFrame={handleMapSelect}
            autoFollow={replay.active}
          />
        </section>
      ) : null}

      {review.frames.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ReplayButton label={t("replayAll")} onClick={startWholeReplay} />
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[1fr_minmax(300px,360px)] lg:items-start lg:gap-4">
        <div className="flex flex-col gap-3">
          {segmentIds.length === 0 ? (
            <p className="rounded-[8px] border border-dashed border-border-strong bg-surface-sunken px-4 py-8 text-center text-[13px] text-neutral-strong">
              {t("noSegments")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {segmentIds.map((segmentId) => {
                const seg = survivingById.get(segmentId);
                const dropped = droppedIds.has(segmentId);
                const isOn = selected.has(segmentId) && !dropped;
                const frames = framesBySegment.get(segmentId) ?? [];
                const manual = corrections.manualScores[segmentId] ?? {};
                const baselineChoice = corrections.baselineLenses[segmentId] ?? [];
                const corrected = Boolean(seg?.humanCorrected);
                const segReset =
                  frames.some((f) => corrections.itemOverrides[f.seq] || excludedSet.has(f.seq)) ||
                  Object.keys(manual).length > 0 ||
                  baselineChoice.length > 0;

                return (
                  <li
                    key={segmentId}
                    className={`${styles.plate} rounded-[8px] border bg-surface-elevated p-4 ${
                      dropped ? "border-dashed border-border opacity-55" : isOn ? "border-border-strong" : "border-border opacity-60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                        <input
                          type="checkbox"
                          checked={isOn}
                          disabled={busy || decided || dropped}
                          onChange={() => toggleApprove(segmentId)}
                          className="size-4 accent-ink-display"
                        />
                        <span className="font-mono">{segmentId}</span>
                      </label>
                      {corrected ? (
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-pine/45 bg-pine/10 px-2 py-0.5 text-[10.5px] font-medium text-pine">
                          <Pencil size={11} strokeWidth={1.75} aria-hidden="true" />
                          {t("humanCorrected")}
                        </span>
                      ) : null}
                      {dropped ? (
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-clay/45 bg-clay/10 px-2 py-0.5 text-[10.5px] font-medium text-clay">
                          {t("segmentDropped")}
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-border-strong bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-neutral-strong">
                          <Camera size={12} strokeWidth={1.75} aria-hidden="true" />
                          {t("cameraObserved")}
                        </span>
                      )}
                      {segReset ? (
                        <button
                          type="button"
                          onClick={() => resetSegment(segmentId)}
                          className={`${styles.control} ${dropped ? "" : "ml-2"} inline-flex items-center gap-1 rounded-[4px] border border-border px-2 py-0.5 text-[10.5px] font-medium text-neutral-strong hover:text-ink`}
                        >
                          <RotateCcw size={11} strokeWidth={1.75} aria-hidden="true" />
                          {t("resetSegment")}
                        </button>
                      ) : null}
                    </div>

                    {dropped ? (
                      <p className="mt-3 text-[12px] text-neutral-strong">{t("segmentDroppedNote")}</p>
                    ) : (
                      <>
                        <SegmentAssessmentPanel
                          assessment={review.assessments[segmentId] ?? null}
                          seg={seg}
                          baselineChoice={baselineChoice}
                          manual={manual}
                          disabled={busy || decided}
                          lensName={(lens) => tl(`${lens}.name`)}
                          onToggleLens={(lens) => toggleBaselineLens(segmentId, lens)}
                          onSetBaselineAll={(lenses) => setSegmentBaseline(segmentId, lenses)}
                        />

                        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {LENS_ORDER.map((lens) => {
                            const v = seg?.scores[lens] ?? null;
                            const modelV = seg?.baselineScores[lens] ?? null;
                            const edited = Object.prototype.hasOwnProperty.call(manual, lens);
                            const changed = edited || (modelV !== null && v !== null && Math.round(modelV) !== Math.round(v)) || (modelV === null) !== (v === null);
                            return (
                              <li
                                key={lens}
                                className={`rounded-[4px] border px-2 py-1.5 ${edited ? "border-pine/45 bg-pine/5" : "border-border bg-surface-sunken"}`}
                              >
                                <p className="flex items-center gap-1 text-[10.5px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
                                  {tl(`${lens}.name`)}
                                  {edited ? <span className="size-1.5 rounded-full bg-pine" aria-hidden="true" /> : null}
                                </p>
                                <label className="sr-only" htmlFor={`sc-${segmentId}-${lens}`}>
                                  {t("editScoreLabel", { lens: tl(`${lens}.name`) })}
                                </label>
                                <input
                                  id={`sc-${segmentId}-${lens}`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  inputMode="numeric"
                                  disabled={busy || decided}
                                  value={v === null ? "" : Math.round(v)}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === "") setManualScore(segmentId, lens, null);
                                    else {
                                      const n = Math.max(0, Math.min(100, Number(raw)));
                                      if (Number.isFinite(n)) setManualScore(segmentId, lens, n);
                                    }
                                  }}
                                  className="mt-0.5 w-full rounded-[3px] border border-transparent bg-transparent px-0 font-mono text-[13px] font-medium text-ink outline-none focus-visible:border-border focus-visible:bg-surface-base focus-visible:px-1"
                                />
                                {changed && modelV !== null ? (
                                  <p className="font-mono text-[9.5px] text-neutral-strong">
                                    {t("wasValue", { value: Math.round(modelV) })}
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>

                        <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                          <div className="flex gap-1.5">
                            <dt className="text-neutral-strong">{t("confidenceLabel")}</dt>
                            <dd className="font-mono text-ink">
                              {pct(seg?.confidence ?? null) === null ? t("unset") : `${pct(seg?.confidence ?? null)}%`}
                            </dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="text-neutral-strong">{t("coverageLabel")}</dt>
                            <dd className="font-mono text-ink">
                              {pct(seg?.coverage ?? null) === null ? t("unset") : `${pct(seg?.coverage ?? null)}%`}
                            </dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="text-neutral-strong">{t("framesLabel")}</dt>
                            <dd className="font-mono text-ink">{seg?.frameRefs.length ?? 0}</dd>
                          </div>
                        </dl>
                      </>
                    )}

                    {frames.length > 0 ? (
                      <div className="mt-2.5">
                        <div className="mb-1.5 flex items-center gap-2">
                          <h3 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                            {t("filmstripHeading")}
                          </h3>
                          <ReplayButton
                            label={t("replaySegment")}
                            onClick={() => startSegmentReplay(segmentId)}
                            compact
                          />
                        </div>
                        <ul className="flex gap-1.5 overflow-x-auto pb-1">
                          {frames.map((f) => (
                            <li key={f.seq} className="shrink-0">
                              <FrameThumb
                                frame={f}
                                excluded={excludedSet.has(f.seq)}
                                deleted={f.deleted || deletedSet.has(f.seq)}
                                overridden={Boolean(corrections.itemOverrides[f.seq])}
                                selected={selectedSeq === f.seq}
                                onSelect={() => setSelectedSeq((s) => (s === f.seq ? null : f.seq))}
                                onExpand={() => setLightboxSeq(f.seq)}
                                alt={t("frameAlt", { seq: f.seq })}
                                expandLabel={t("enlargeFrame", { seq: f.seq })}
                              />
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

          {unmatchedFrames.length > 0 ? (
            <section className={`${styles.plate} rounded-[8px] border border-dashed border-border-strong bg-surface-elevated p-4`}>
              <h3 className="mb-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
                {t("unmatchedHeading", { count: unmatchedFrames.length })}
              </h3>
              <ul className="flex gap-1.5 overflow-x-auto pb-1">
                {unmatchedFrames.map((f) => (
                  <li key={f.seq} className="shrink-0">
                    <FrameThumb
                      frame={f}
                      excluded={excludedSet.has(f.seq)}
                      deleted={f.deleted || deletedSet.has(f.seq)}
                      overridden={false}
                      selected={selectedSeq === f.seq}
                      onSelect={() => setSelectedSeq((s) => (s === f.seq ? null : f.seq))}
                      onExpand={() => setLightboxSeq(f.seq)}
                      alt={t("frameAlt", { seq: f.seq })}
                      expandLabel={t("enlargeFrame", { seq: f.seq })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Right rail: the frame inspector. Sticky on desktop; scrolls into view on
            phones when a frame is tapped. */}
        <aside ref={inspectorRef} className="mt-3 lg:mt-0 lg:sticky lg:top-4">
          {selectedFrame ? (
            <FrameInspector
              key={selectedFrame.seq}
              frame={selectedFrame}
              overrides={corrections.itemOverrides[selectedFrame.seq]}
              excluded={excludedSet.has(selectedFrame.seq)}
              onOverrideItem={(key, value) => overrideItem(selectedFrame.seq, key, value)}
              onToggleExclude={() => toggleExclude(selectedFrame.seq)}
              onDelete={() => deleteFrame(selectedFrame.seq)}
              onResetFrame={() => resetFrame(selectedFrame.seq)}
              onExpandImage={() => setLightboxSeq(selectedFrame.seq)}
              onClose={() => setSelectedSeq(null)}
            />
          ) : (
            <p className="hidden rounded-[8px] border border-dashed border-border bg-surface-sunken px-4 py-6 text-center text-[12px] text-neutral-strong lg:block">
              {t("inspectorHint")}
            </p>
          )}
        </aside>
      </div>

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
              className="resize-y rounded-[4px] border border-border bg-surface-base px-3 py-2 text-[16px] text-ink outline-none transition-colors placeholder:text-neutral focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-ink sm:text-[13px]"
            />
          </label>

          {error ? (
            <p role="alert" className="mt-2 text-[12px] font-medium text-clay">
              {error}
            </p>
          ) : null}

          <p className="mt-2 text-[12px] text-neutral-strong">
            {t("approveSummary", { count: approvableSelected.length, total: segmentIds.length })}
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

      {lightboxSeq !== null ? (
        <FrameLightbox
          frames={review.frames}
          seq={lightboxSeq}
          excluded={excludedSet}
          deleted={deletedSet}
          onSeqChange={setLightboxSeq}
          onClose={() => setLightboxSeq(null)}
        />
      ) : null}

      {/* Session replay: one engine, two surfaces. The expanded map wins when open so
          the two overlays never stack; playback survives the switch either way. */}
      {mapExpanded && hasMap ? (
        <ExpandedMap
          track={review.track}
          frames={review.frames}
          matchedGeometry={matchedGeometry}
          excludedSeqs={corrections.excluded}
          deletedSeqs={corrections.deleted}
          selectedSeq={mapSelectedSeq}
          selectedSegmentId={mapSelectedSegmentId}
          onSelectFrame={handleMapSelect}
          replay={replay}
          onStartReplay={startWholeReplay}
          onViewFrames={() => setMapExpanded(false)}
          onClose={() => setMapExpanded(false)}
        />
      ) : replay.active ? (
        <ReplayPlayer
          replay={replay}
          frames={review.frames}
          excluded={excludedSet}
          deleted={deletedSet}
          onViewOnMap={() => (hasMap ? setMapExpanded(true) : undefined)}
        />
      ) : null}
    </div>
  );
}

/** Round a score for display; a null (unmeasured) lens shows an em-free dash. */
function fmtScore(v: number | null | undefined): string {
  return typeof v === "number" ? String(Math.round(v)) : "–";
}

/**
 * The segment synthesis, per sealed decision 2: the overall verdict a reviewer
 * reads first, then per-lens explanations beside their scores, with each
 * adjustment's baseline and adjusted value side by side (delta + reason) and a
 * one-tap "use baseline" per lens and per segment. The ADJUSTED value is the
 * default; the chosen number lives in the score grid below and a manual edit wins.
 * A null assessment renders an honest "no assessment available" state.
 */
function SegmentAssessmentPanel({
  assessment,
  seg,
  baselineChoice,
  manual,
  disabled,
  lensName,
  onToggleLens,
  onSetBaselineAll,
}: Readonly<{
  assessment: SegmentAssessment | null;
  seg: RecomputedSegment | undefined;
  baselineChoice: LensKey[];
  manual: Partial<Record<LensKey, number | null>>;
  disabled: boolean;
  lensName: (lens: LensKey) => string;
  onToggleLens: (lens: LensKey) => void;
  onSetBaselineAll: (lenses: LensKey[]) => void;
}>) {
  const t = useTranslations("admin.capture");

  if (!assessment) {
    return (
      <p className="mt-3 rounded-[6px] border border-dashed border-border bg-surface-sunken px-3 py-2 text-[12px] text-neutral-strong">
        {t("noAssessment")}
      </p>
    );
  }

  const chosenBaseline = new Set(baselineChoice);
  const adjustedLenses = LENS_ORDER.filter((lens) => {
    const a = assessment.adjustments?.[lens];
    return a && typeof a.delta === "number" && Number.isFinite(a.delta);
  });
  const allBaseline =
    adjustedLenses.length > 0 && adjustedLenses.every((lens) => chosenBaseline.has(lens));

  return (
    <div className="mt-3 rounded-[8px] border border-accent/35 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          <Sparkles size={13} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
          {t("assessmentHeading")}
        </span>
        <span className="text-[10.5px] text-neutral-strong">
          {t("assessmentModel", { model: assessment.model || "—" })}
        </span>
        {seg?.assessmentStale ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber/45 bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-ink">
            <TriangleAlert size={11} strokeWidth={1.75} aria-hidden="true" />
            {t("assessmentStale")}
          </span>
        ) : null}
        {adjustedLenses.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSetBaselineAll(allBaseline ? [] : adjustedLenses)}
            className={`${styles.control} ml-auto inline-flex items-center gap-1 rounded-[4px] border border-border px-2 py-0.5 text-[10.5px] font-medium text-neutral-strong hover:text-ink disabled:opacity-55`}
          >
            <RotateCcw size={11} strokeWidth={1.75} aria-hidden="true" />
            {allBaseline ? t("useAdjustedAll") : t("useBaselineAll")}
          </button>
        ) : null}
      </div>

      {/* The overall verdict — the first thing a reviewer reads. */}
      <p className="mt-2 text-[13px] leading-snug text-ink">{assessment.overall}</p>
      <p className="mt-1 text-[10.5px] text-neutral-strong">{t("assessmentNote")}</p>

      {/* Per-lens explanations, each beside its baseline/adjusted comparison. */}
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {LENS_ORDER.map((lens) => {
          const explanation = lens === "overall" ? null : assessment.lenses?.[lens] ?? null;
          const adj = adjustedLenses.includes(lens) ? assessment.adjustments![lens]! : null;
          if (!explanation && !adj) return null;

          const baseVal = seg?.baselineScores[lens] ?? null;
          const adjVal = seg?.adjustedScores[lens] ?? null;
          const usingBaseline = chosenBaseline.has(lens);
          const manualSet = Object.prototype.hasOwnProperty.call(manual, lens);
          const delta = adj ? adj.delta : 0;
          const sign = delta >= 0 ? "+" : "";

          return (
            <li
              key={lens}
              className="rounded-[6px] border border-border bg-surface-elevated px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-neutral-strong">
                  {lensName(lens)}
                </span>
                {adj ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                    <span className={`${usingBaseline ? "font-semibold text-ink" : "text-neutral-strong"}`}>
                      {t("baselineLabel")} {fmtScore(baseVal)}
                    </span>
                    <span className="text-neutral-strong" aria-hidden="true">→</span>
                    <span className={`${usingBaseline ? "text-neutral-strong" : "font-semibold text-ink"}`}>
                      {t("adjustedLabel")} {fmtScore(adjVal)}
                    </span>
                    <span
                      className={`rounded-[3px] px-1 py-0.5 text-[9.5px] font-medium ${
                        delta >= 0 ? "bg-pine/12 text-pine" : "bg-clay/12 text-clay"
                      }`}
                    >
                      {sign}
                      {Math.round(delta)}
                    </span>
                  </span>
                ) : null}
                {adj ? (
                  <button
                    type="button"
                    disabled={disabled || manualSet}
                    onClick={() => onToggleLens(lens)}
                    className={`${styles.control} ml-auto inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[10.5px] font-medium disabled:opacity-45 ${
                      usingBaseline
                        ? "border-border text-neutral-strong hover:text-ink"
                        : "border-accent/45 bg-accent/10 text-accent hover:bg-accent/20"
                    }`}
                    title={manualSet ? t("wasValue", { value: fmtScore(seg?.scores[lens] ?? null) }) : undefined}
                  >
                    {usingBaseline ? t("useAdjusted") : t("useBaseline")}
                  </button>
                ) : null}
              </div>
              {explanation ? (
                <p className="mt-1 text-[12px] leading-snug text-ink">{explanation}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One clickable frame thumbnail: struck when excluded, tombstoned when deleted.
 *
 * The thumbnail body still opens the inspector (unchanged); the corner magnifier
 * is the explicit one-tap escape hatch to the full-size lightbox. They are
 * siblings, not nested, so the markup stays a valid pair of buttons.
 */
function FrameThumb({
  frame,
  excluded,
  deleted,
  overridden,
  selected,
  onSelect,
  onExpand,
  alt,
  expandLabel,
}: Readonly<{
  frame: ReviewFrame;
  excluded: boolean;
  deleted: boolean;
  overridden: boolean;
  selected: boolean;
  onSelect: () => void;
  onExpand: () => void;
  alt: string;
  expandLabel: string;
}>) {
  return (
    <div className="group relative size-[72px] w-[96px]">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-frame-seq={frame.seq}
        className={`relative block size-full overflow-hidden rounded-[4px] border ${
          selected ? "border-ink ring-2 ring-ink" : "border-border"
        }`}
      >
        {deleted ? (
          <span className="flex h-full w-full items-center justify-center bg-surface-sunken font-mono text-[10px] text-clay line-through">
            {frame.seq}
          </span>
        ) : frame.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frame.url}
            alt={alt}
            loading="lazy"
            decoding="async"
            width={96}
            height={72}
            className={`h-[72px] w-[96px] object-cover ${excluded ? "opacity-40 grayscale" : ""}`}
          />
        ) : (
          <span className={`flex h-full w-full items-center justify-center bg-surface-sunken font-mono text-[10px] text-neutral-strong ${excluded ? "line-through" : ""}`}>
            {frame.seq}
          </span>
        )}
        {excluded && !deleted ? (
          <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[8.5px] font-medium uppercase tracking-wide text-surface">
            excl
          </span>
        ) : null}
        {overridden && !excluded && !deleted ? (
          <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-pine ring-1 ring-surface" aria-hidden="true" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={onExpand}
        aria-label={expandLabel}
        data-expand-seq={frame.seq}
        className="absolute bottom-0.5 left-0.5 inline-flex size-5 items-center justify-center rounded-[3px] border border-ink/20 bg-surface/85 text-ink opacity-80 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink group-hover:opacity-100"
      >
        <Maximize2 size={11} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
