"use client";

/**
 * Session replay (u3).
 *
 * Plays a capture session's frames back like footage: whole-session (every frame
 * in seq order) or one segment at a time. It is a dedicated player, but it shares
 * the lightbox's chrome and idioms on purpose (portal overlay, focus trap,
 * body-scroll lock, Esc/backdrop close, the same struck/tombstone frame treatment)
 * so a reviewer never meets two different full-size viewers.
 *
 * The playback engine is `useReplay`: it owns index/playing/speed and advances a
 * dwell timer while playing. The parent lifts this hook so the SAME playback drives
 * both surfaces — this frame-first player AND the expanded map — and so the map's
 * current-dot highlight rides the existing selection sync (the parent points the
 * map's `selectedSeq` at `replay.currentSeq`; the replay never forks its own sync).
 *
 * `ReplayControls` is the one control cluster (play/pause, speed, scrub) rendered by
 * both surfaces, so the two views stay in lockstep.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Map as MapIcon, Pause, Play, X } from "lucide-react";
import type { ReviewFrame } from "@/lib/capture/review-store";

/** 1x dwell per frame (ms). Faster speeds divide this. */
const BASE_DWELL_MS = 800;
/** Speeds offered, in the order the selector shows them. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
/** How many upcoming frames to warm in the browser cache so playback never stutters. */
const PRELOAD_AHEAD = 3;

export type ReplayController = {
  /** Overlay open (a scope is loaded). */
  active: boolean;
  /** The ordered seqs of the current scope (whole session or one segment). */
  seqs: number[];
  index: number;
  playing: boolean;
  speed: number;
  /** The seq under the playhead, or null when closed. */
  currentSeq: number | null;
  start: (seqs: number[], startIndex?: number) => void;
  stop: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  stepBy: (delta: number) => void;
  seekTo: (index: number) => void;
  seekToSeq: (seq: number) => void;
  setSpeed: (s: number) => void;
};

/** The playback state machine, lifted by the parent so both surfaces share it. */
export function useReplay(): ReplayController {
  const [seqs, setSeqs] = useState<number[]>([]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const last = Math.max(0, seqs.length - 1);
  const clampedIndex = Math.min(Math.max(0, index), last);
  const atEnd = clampedIndex >= last;

  const start = useCallback((s: number[], startIndex = 0) => {
    if (s.length === 0) return;
    setSeqs(s);
    setIndex(Math.min(Math.max(0, startIndex), s.length - 1));
    setActive(true);
    setPlaying(true);
  }, []);
  const stop = useCallback(() => {
    setActive(false);
    setPlaying(false);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  // Play from the end restarts from the first frame; otherwise resumes in place.
  const play = useCallback(() => {
    setIndex((i) => (i >= last ? 0 : i));
    setPlaying(true);
  }, [last]);
  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setIndex((i) => (i >= last ? 0 : i));
    setPlaying(true);
  }, [playing, last]);
  const seekTo = useCallback((i: number) => setIndex(i), []);
  const stepBy = useCallback(
    (d: number) => {
      setPlaying(false);
      setIndex((i) => Math.min(Math.max(0, i + d), last));
    },
    [last],
  );
  const seekToSeq = useCallback(
    (seq: number) => {
      const i = seqs.indexOf(seq);
      if (i !== -1) setIndex(i);
    },
    [seqs],
  );

  // Advance one frame per dwell while playing. The stop-at-end decision lives in
  // the timeout callback (async), not the effect body, so no cascading render.
  useEffect(() => {
    if (!active || !playing || atEnd) return;
    const id = window.setTimeout(() => {
      const next = Math.min(clampedIndex + 1, last);
      setIndex(next);
      if (next >= last) setPlaying(false);
    }, BASE_DWELL_MS / speed);
    return () => window.clearTimeout(id);
  }, [active, playing, atEnd, clampedIndex, last, speed]);

  const currentSeq = active && seqs.length > 0 ? seqs[clampedIndex] : null;

  return {
    active,
    seqs,
    index: clampedIndex,
    playing,
    speed,
    currentSeq,
    start,
    stop,
    toggle,
    play,
    pause,
    stepBy,
    seekTo,
    seekToSeq,
    setSpeed,
  };
}

/**
 * The one control cluster (play/pause, speed, scrub) shared by the frame player and
 * the expanded map. `tone` matches the surface it sits on: the player is on a dark
 * backdrop, the map bar on the app surface.
 */
export function ReplayControls({
  replay,
  tone = "dark",
}: Readonly<{ replay: ReplayController; tone?: "dark" | "light" }>) {
  const t = useTranslations("admin.capture");
  const total = replay.seqs.length;
  const dark = tone === "dark";

  const wasPlayingRef = useRef(false);
  function onScrubStart() {
    wasPlayingRef.current = replay.playing;
    replay.pause();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={replay.toggle}
          aria-label={replay.playing ? t("replayPause") : t("replayPlay")}
          data-replay-toggle
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 ${
            dark
              ? "border border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white"
              : "border border-border-strong bg-ink-display text-surface hover:opacity-90 focus-visible:ring-ink"
          }`}
        >
          {replay.playing ? (
            <Pause size={18} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Play size={18} strokeWidth={2} aria-hidden="true" />
          )}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          step={1}
          value={replay.index}
          aria-label={t("replayScrub")}
          data-replay-scrub
          onPointerDown={onScrubStart}
          onMouseDown={onScrubStart}
          onTouchStart={onScrubStart}
          onChange={(e) => replay.seekTo(Number(e.target.value))}
          className={`h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full ${
            dark ? "bg-white/25 accent-white" : "bg-border-strong accent-ink-display"
          }`}
        />

        <span
          className={`shrink-0 font-mono text-[11.5px] tabular-nums ${
            dark ? "text-white/70" : "text-neutral-strong"
          }`}
        >
          {t("replayCounter", { index: replay.index + 1, total })}
        </span>
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label={t("replaySpeedLabel")}>
        {REPLAY_SPEEDS.map((s) => {
          const on = replay.speed === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => replay.setSpeed(s)}
              aria-pressed={on}
              data-replay-speed={s}
              className={`rounded-[4px] border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 ${
                dark
                  ? on
                    ? "border-white bg-white text-ink focus-visible:ring-white"
                    : "border-white/25 bg-white/5 text-white/70 hover:bg-white/15 focus-visible:ring-white"
                  : on
                    ? "border-ink bg-ink-display text-surface focus-visible:ring-ink"
                    : "border-border text-neutral-strong hover:text-ink focus-visible:ring-ink"
              }`}
            >
              {s}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The frame-first replay surface: the current frame full size (struck if excluded,
 * a tombstone placeholder if deleted, never a broken image), its caption
 * (seq + segment + rationale), the shared controls, and a one-tap switch to the
 * expanded map so the reviewer can watch the same playhead travel the track.
 */
export default function ReplayPlayer({
  replay,
  frames,
  excluded,
  deleted,
  onViewOnMap,
}: Readonly<{
  replay: ReplayController;
  /** Every frame of the session; the player looks the current seq up here. */
  frames: ReviewFrame[];
  /** Seqs the reviewer excluded (played struck) and deleted (played as a tombstone). */
  excluded: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  /** Switch to the expanded map; omitted (button hidden) when the session has no map. */
  onViewOnMap?: () => void;
}>) {
  const t = useTranslations("admin.capture");
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const bySeq = useMemo(() => new Map(frames.map((f) => [f.seq, f])), [frames]);
  const frame = replay.currentSeq === null ? null : bySeq.get(replay.currentSeq) ?? null;

  // Preload the next few frames so a play never waits on a fetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    for (let k = 1; k <= PRELOAD_AHEAD; k++) {
      const seq = replay.seqs[replay.index + k];
      if (seq === undefined) break;
      const url = bySeq.get(seq)?.url;
      if (url) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = url;
      }
    }
  }, [replay.index, replay.seqs, bySeq]);

  // Keyboard: space toggles, arrows step, Esc closes. Bound while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        replay.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        replay.stepBy(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        replay.stepBy(1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        replay.stop();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [replay]);

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

  function onTrapKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && activeEl === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!frame) return null;

  const isDeleted = frame.deleted || deleted.has(frame.seq);
  const isExcluded = excluded.has(frame.seq);
  const rationale = frame.observation?.rationale ?? null;
  const segmentLabel = frame.segmentId ?? t("unmatched");

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("replayTitle")}
      tabIndex={-1}
      data-replay-player
      data-replay-seq={frame.seq}
      onKeyDown={onTrapKey}
      onClick={replay.stop}
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 outline-none backdrop-blur-sm"
    >
      {/* Top bar: title + view-on-map + close. */}
      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <span className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-white/70">
          {t("replayTitle")}
        </span>
        {onViewOnMap ? (
          <button
            type="button"
            onClick={onViewOnMap}
            data-replay-view-map
            className="ml-auto inline-flex items-center gap-1.5 rounded-[6px] border border-white/20 bg-white/10 px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <MapIcon size={15} strokeWidth={2} aria-hidden="true" />
            <span className="hidden sm:inline">{t("replayViewOnMap")}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={replay.stop}
          aria-label={t("replayClose")}
          className={`${onViewOnMap ? "" : "ml-auto "}inline-flex size-9 items-center justify-center rounded-[6px] border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Stage: the frame, fit to the available space. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-14">
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
      </div>

      {/* Caption + controls. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 border-t border-white/10 bg-black/60 px-3 py-3 sm:px-4"
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-mono text-[12.5px] font-semibold text-white">
            {t("inspectorTitle", { seq: frame.seq })}
          </span>
          <span className="font-mono text-[11.5px] text-white/60">{segmentLabel}</span>
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
          <p className="mb-2.5 max-w-3xl text-[12.5px] leading-relaxed text-white/75">{rationale}</p>
        ) : null}
        <ReplayControls replay={replay} tone="dark" />
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}

/** A small inline trigger button (play icon + label) reused by the workbench. */
export function ReplayButton({
  label,
  onClick,
  compact = false,
}: Readonly<{ label: string; onClick: () => void; compact?: boolean }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-replay-start
      className={`inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface-sunken font-medium text-neutral-strong transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
        compact ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[12px]"
      }`}
    >
      <Play size={compact ? 11 : 13} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}
