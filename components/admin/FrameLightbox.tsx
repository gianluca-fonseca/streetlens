"use client";

/**
 * One frame, full size (u1 lightbox).
 *
 * The reviewer is often on a phone, and a 96px filmstrip thumbnail is too small
 * to judge a curb ramp or a faded crossing. This is the escape hatch: any
 * thumbnail in the workbench (filmstrip, or the inspector's own image opened from
 * a map-dot selection) enlarges here to a fit-to-screen overlay, with the model's
 * rationale for context and left/right navigation across the WHOLE walk in seq
 * order — nothing skipped. An excluded frame keeps its struck state; a deleted
 * frame shows the tombstone, never a broken image.
 *
 * Self-contained: it manages its own focus trap, body-scroll lock, keyboard and
 * swipe navigation, and returns focus to whatever opened it on close. The parent
 * only holds the "which seq is open" state and feeds it the session's frames.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Ban, X } from "lucide-react";
import type { ReviewFrame } from "@/lib/capture/review-store";

/** Horizontal travel (px) past which a touch drag counts as a swipe, not a tap. */
const SWIPE_THRESHOLD = 48;
/** Above this many characters the rationale is clamped with an expand toggle. */
const RATIONALE_CLAMP = 180;

export default function FrameLightbox({
  frames,
  seq,
  excluded,
  deleted,
  segmentCaption,
  onToggleExclude,
  onSeqChange,
  onClose,
}: Readonly<{
  /** Every frame of the walk; the lightbox orders them by seq itself. */
  frames: ReviewFrame[];
  /** The open frame's seq. The parent renders this component only when non-null. */
  seq: number;
  /** Seqs the reviewer excluded from scoring (shown struck, still navigable). */
  excluded: ReadonlySet<number>;
  /** Seqs whose bytes were tombstoned (server `deleted` or a local delete). */
  deleted: ReadonlySet<number>;
  /** Human street name + district for the caption. */
  segmentCaption?: string;
  /** Toggle exclude/include for the current frame without closing the lightbox. */
  onToggleExclude?: () => void;
  onSeqChange: (seq: number) => void;
  onClose: () => void;
}>) {
  const t = useTranslations("admin.capture");
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Expansion is tied to a seq, not a bare flag, so navigating to another frame
  // shows its rationale collapsed again without an effect to reset it.
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  // Stable seq order; the walk's own numbering, so navigation matches the filmstrip.
  const ordered = useMemo(() => [...frames].sort((a, b) => a.seq - b.seq), [frames]);
  const index = ordered.findIndex((f) => f.seq === seq);
  const frame = index === -1 ? null : ordered[index];
  const expanded = expandedSeq === seq;

  const go = useCallback(
    (delta: number) => {
      if (ordered.length === 0 || index === -1) return;
      // Wrap within the walk in both directions; skip nothing.
      const next = (index + delta + ordered.length) % ordered.length;
      onSeqChange(ordered[next].seq);
    },
    [ordered, index, onSeqChange],
  );

  // Keyboard: Esc closes, arrows navigate, e toggles exclude. Bound while open only.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cur = ordered.find((f) => f.seq === seq);
      const curDeleted = cur ? cur.deleted || deleted.has(cur.seq) : true;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "e" && onToggleExclude && !curDeleted) {
        e.preventDefault();
        onToggleExclude();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose, onToggleExclude, ordered, seq, deleted]);

  // Lock body scroll while open; restore the exact prior value on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Remember what had focus, move focus into the dialog, and restore on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Focus trap: keep Tab / Shift+Tab cycling within the dialog's controls.
  function onTrapKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // A mostly-horizontal drag past the threshold is a swipe; left goes forward.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  }

  if (!frame) return null;

  const isDeleted = frame.deleted || deleted.has(frame.seq);
  const isExcluded = excluded.has(frame.seq);
  const rationale = frame.observation?.rationale ?? null;
  const segmentLabel = segmentCaption || frame.segmentId || t("unmatched");
  const canNavigate = ordered.length > 1;
  const longRationale = rationale !== null && rationale.length > RATIONALE_CLAMP;

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("lightboxTitle", { seq: frame.seq })}
      tabIndex={-1}
      data-lightbox
      data-frame-seq={frame.seq}
      onKeyDown={onTrapKey}
      // Backdrop tap closes; clicks on the inner panels stop the propagation.
      onClick={onClose}
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 outline-none backdrop-blur-sm"
    >
      {/* Top bar: counter + close, always reachable at the top on a phone. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 px-3 py-2.5 sm:px-4"
      >
        <span className="font-mono text-[12px] font-medium text-white/70">
          {t("lightboxCounter", { index: index + 1, total: ordered.length })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("lightboxClose")}
          className="ml-auto inline-flex size-9 items-center justify-center rounded-[6px] border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Stage: the image, fit to the available space. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-14"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {canNavigate ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={t("lightboxPrev")}
            className="absolute left-1 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-3"
          >
            <ChevronLeft size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}

        {isDeleted ? (
          <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-white/25 bg-white/5 px-8 py-14 text-center">
            <span className="font-mono text-[13px] font-medium text-white/80 line-through">
              {t("inspectorTitle", { seq: frame.seq })}
            </span>
            <span className="max-w-xs text-[12.5px] leading-relaxed text-white/55">
              {t("frameDeletedNote")}
            </span>
          </div>
        ) : frame.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frame.url}
            alt={t("frameAlt", { seq: frame.seq })}
            decoding="async"
            onClick={(e) => e.stopPropagation()}
            className={`max-h-full max-w-full rounded-[4px] object-contain ${
              isExcluded ? "opacity-50 grayscale" : ""
            }`}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-white/25 bg-white/5 px-8 py-14 text-center">
            <span className="font-mono text-[13px] font-medium text-white/70">
              {t("inspectorTitle", { seq: frame.seq })}
            </span>
            <span className="text-[12.5px] text-white/50">{t("noReading")}</span>
          </div>
        )}

        {canNavigate ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t("lightboxNext")}
            className="absolute right-1 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-3"
          >
            <ChevronRight size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Caption: seq + segment + state, then the model's rationale. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 border-t border-white/10 bg-black/60 px-3 py-3 sm:px-4"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-mono text-[12.5px] font-semibold text-white">
            {t("inspectorTitle", { seq: frame.seq })}
          </span>
          <span className="font-mono text-[11.5px] text-white/60">{segmentLabel}</span>
          {onToggleExclude && !isDeleted ? (
            <button
              type="button"
              onClick={onToggleExclude}
              className="ml-auto inline-flex items-center gap-1 rounded-[4px] border border-white/25 bg-white/10 px-2 py-0.5 text-[10.5px] font-medium text-white/90 hover:bg-white/20"
            >
              <Ban size={12} strokeWidth={1.75} aria-hidden="true" />
              {isExcluded ? t("includeFrame") : t("excludeFrame")}
            </button>
          ) : null}
          {isDeleted ? (
            <span className="inline-flex items-center rounded-[4px] border border-clay/50 bg-clay/20 px-1.5 py-0.5 text-[10.5px] font-medium text-clay">
              {t("frameDeleted")}
            </span>
          ) : isExcluded ? (
            <span className="inline-flex items-center rounded-[4px] border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium text-white/80">
              {t("frameExcluded")}
            </span>
          ) : null}
        </div>

        {rationale ? (
          <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-white/75">
            {longRationale && !expanded ? `${rationale.slice(0, RATIONALE_CLAMP).trimEnd()}…` : rationale}
            {longRationale ? (
              <button
                type="button"
                onClick={() => setExpandedSeq((cur) => (cur === frame.seq ? null : frame.seq))}
                className="ml-1.5 align-baseline text-[12px] font-medium text-white/90 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {expanded ? t("rationaleLess") : t("rationaleMore")}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
