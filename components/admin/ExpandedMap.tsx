"use client";

/**
 * The review map, full viewport (u3).
 *
 * One tap on the panel's expand control opens the whole session track here, fit to
 * view with padding, with every frame dot and segment highlight as interactive as
 * in the panel (selection sync is preserved both ways — this renders a second
 * ReviewMap instance and feeds it the SAME selected seq/segment the panel uses).
 *
 * The replay controls travel with it: a reviewer can play, scrub, and change speed
 * from here and watch the playhead dot cross the full map, then drop back to the
 * frame-first player without losing playback. Shares the lightbox overlay idioms
 * (portal, Esc/X/backdrop close, body-scroll lock, focus return).
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Minimize2, X } from "lucide-react";
import type { FramePosition, ReviewFrame } from "@/lib/capture/review-store";
import ReviewMap, { type MatchedGeometry } from "./ReviewMap";
import { ReplayButton, ReplayControls, type ReplayController } from "./SessionReplay";

export default function ExpandedMap({
  track,
  frames,
  matchedGeometry,
  excludedSeqs,
  deletedSeqs,
  selectedSeq,
  selectedSegmentId,
  onSelectFrame,
  replay,
  onStartReplay,
  onViewFrames,
  onClose,
}: Readonly<{
  track: readonly FramePosition[];
  frames: readonly ReviewFrame[];
  matchedGeometry: readonly MatchedGeometry[];
  excludedSeqs: number[];
  deletedSeqs: number[];
  selectedSeq: number | null;
  selectedSegmentId: string | null;
  onSelectFrame: (seq: number) => void;
  replay: ReplayController;
  /** Start whole-session replay from the expanded map (when nothing is playing yet). */
  onStartReplay: () => void;
  /** Drop back to the frame-first player, playback intact. */
  onViewFrames: () => void;
  onClose: () => void;
}>) {
  const t = useTranslations("admin.capture");
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const current = replay.currentSeq === null ? null : frames.find((f) => f.seq === replay.currentSeq) ?? null;

  // Keyboard: Esc closes; while replaying, space toggles and arrows step.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (replay.active && (e.key === " " || e.key === "Spacebar")) {
        e.preventDefault();
        replay.toggle();
      } else if (replay.active && e.key === "ArrowLeft") {
        e.preventDefault();
        replay.stepBy(-1);
      } else if (replay.active && e.key === "ArrowRight") {
        e.preventDefault();
        replay.stepBy(1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [replay, onClose]);

  // Lock body scroll while open; restore on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Remember focus, move it into the dialog, restore on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("mapExpandedTitle")}
      tabIndex={-1}
      data-expanded-map
      // Clicks on the chrome backdrop close; the map and control bar stop propagation.
      onClick={onClose}
      className="fixed inset-0 z-[60] flex flex-col bg-surface-base/95 outline-none backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 border-b border-border bg-surface-elevated px-3 py-2.5 sm:px-4"
      >
        <span className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
          {t("mapExpandedTitle")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("mapCollapse")}
          data-expanded-map-close
          className="ml-auto inline-flex size-9 items-center justify-center rounded-[6px] border border-border bg-surface-sunken text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("mapCollapse")}
          className="inline-flex size-9 items-center justify-center rounded-[6px] border border-border bg-surface-sunken text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div onClick={(e) => e.stopPropagation()} className="relative min-h-0 flex-1">
        <ReviewMap
          variant="expanded"
          track={track}
          frames={frames}
          matchedGeometry={matchedGeometry}
          excludedSeqs={excludedSeqs}
          deletedSeqs={deletedSeqs}
          selectedSeq={selectedSeq}
          selectedSegmentId={selectedSegmentId}
          onSelectFrame={onSelectFrame}
          autoFollow={replay.active}
        />
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 border-t border-border bg-surface-elevated px-3 py-3 sm:px-4"
      >
        {replay.active ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {current ? (
                <>
                  <span className="font-mono text-[12px] font-semibold text-ink">
                    {t("inspectorTitle", { seq: current.seq })}
                  </span>
                  <span className="font-mono text-[11px] text-neutral-strong">
                    {current.segmentId ?? t("unmatched")}
                  </span>
                </>
              ) : null}
              <button
                type="button"
                onClick={onViewFrames}
                data-replay-view-frames
                className="ml-auto inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken px-2.5 py-1 text-[12px] font-medium text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                {t("replayViewFrames")}
              </button>
            </div>
            <ReplayControls replay={replay} tone="light" />
          </div>
        ) : (
          <ReplayButton label={t("replayAll")} onClick={onStartReplay} />
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
