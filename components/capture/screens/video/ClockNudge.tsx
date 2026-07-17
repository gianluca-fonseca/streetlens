"use client";

/**
 * The ±60 s start-time correction, and the preview that makes it judgeable.
 *
 * WHY THIS EXISTS AT ALL. `deriveVideoStartMs` guesses when a video started from
 * the file's mtime minus its duration, because a camera writes the file when
 * recording stops. That guess is wrong often enough to matter: some export
 * pipelines rewrite mtime, some transfers stamp it with the copy time. When the
 * route is a timed GPX, its fixes are real measured times and the frames are
 * placed against them, so a start that is thirty seconds off puts every frame
 * thirty seconds of walking down the wrong stretch of street. This slider is the
 * only way to fix that, and the preview is the only way to know it needs fixing.
 *
 * WHY IT IS ONLY RENDERED FOR A TIMED GPX. This component is mounted behind
 * `clockNudgeMatters`, and the caller shows an honest line instead of it
 * otherwise. That is not laziness, it is the whole point. On a drawn trace and on
 * an untimed GPX the track's times are DERIVED from the video's start, so moving
 * the start shifts the frames and the track by the same amount and every frame
 * interpolates to precisely where it did before. A slider there would visibly
 * change a number and provably change nothing about the data, which is a lie told
 * with a control. See `setVideoStart` in `engine/video-session.ts`.
 *
 * WHAT THE PREVIEW ACTUALLY SHOWS, STATED HONESTLY. The picture is the first
 * sampled frame, seeked out of the source file in a `<video>` element rather than
 * read back from the frames in OPFS: the hook exposes no handle on the store, and
 * re-reading a JPEG through it would buy a slightly more literal thumbnail for a
 * lot of plumbing. The picture does not change as you drag, and it should not:
 * the video is what it is, and it is the frame's PLACE that moves. What is live
 * is the place. The sketch redraws and the coordinates recompute on every input
 * event, straight from `interpolateAt` on the same track the upload will carry,
 * so what you see is the read model the server gets and not an approximation of
 * it.
 *
 * WHY THE OFFSET IS RECOMPUTED HERE RATHER THAN READ. Frame times live in the
 * manifest, which the hook keeps in a ref and does not publish. Rather than reach
 * for it, this recomputes the same two pure functions the engine used
 * (`deriveVideoStartMs` and `sampleTargetsMs`) from the same two inputs (the file
 * and the plan). It is the same arithmetic, not a parallel model of it, and it
 * stays true as long as the engine's derivation does.
 *
 * WHY OUT-OF-RANGE IS A STATE, NOT A CLAMP. `interpolateAt` returns null outside
 * the track's time span, deliberately: a frame shot a minute before the GPX
 * started was not at its first fix. So an offset that walks the frame off the end
 * of the file shows that as a notice, which is exactly the diagnostic the
 * contributor needs. Clamping to the endpoint would draw a marker on the line and
 * quietly assert a position nobody measured.
 *
 * NO GLASS. The sketch is an SVG, not map tiles, and the thumbnail is a `<video>`
 * of an uploaded file, which the design direction is explicit is NOT tiles: both
 * get `Plate` plus a hairline. Nothing here is pink. A preview marker is not a
 * CTA, an active state, or a LIVE dot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Eyebrow, Notice, Plate } from "@/components/capture/ui";
import { deriveVideoStartMs } from "@/components/capture/engine/video-session";
import { sampleTargetsMs, type ExtractionPlan } from "@/components/capture/engine/video-plan";
import { interpolateAt } from "@/lib/capture/track";
import type { TrackPoint } from "@/lib/capture/types";

/** The correction the slider can reach, either way. */
const RANGE_MS = 60_000;
/** One second per notch. Finer would be false precision at walking pace. */
const STEP_MS = 1_000;
/**
 * How long the slider must rest before the nudge is committed.
 *
 * The value handed to `nudgeClock` is always the absolute offset from the file's
 * own guess, exactly as the slider reads it, so this changes WHEN the commit
 * happens and never WHAT is committed. It exists because every nudge rewrites the
 * whole manifest to OPFS, and a drag across the range fires that a hundred times
 * for a hundred states nobody asked to keep.
 */
const COMMIT_DELAY_MS = 180;

const SKETCH_W = 220;
const SKETCH_H = 120;
const SKETCH_PAD = 8;

type Point = Readonly<{ lat: number; lng: number }>;

/**
 * A flat projection, good enough for a sketch a few hundred metres across.
 *
 * Longitude is scaled by cos(latitude) so a street does not come out stretched
 * sideways. This is not a map and does not want to be one: it is the shape of the
 * route with a dot on it, and a real basemap here would cost a MapLibre instance
 * that re-fits on every drag.
 */
function useSketch(track: readonly TrackPoint[]) {
  return useMemo(() => {
    if (track.length < 2) return null;

    const midLat = track.reduce((sum, p) => sum + p.lat, 0) / track.length;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const flat = (p: Point) => ({ x: p.lng * kx, y: -p.lat });

    const xs = track.map((p) => flat(p).x);
    const ys = track.map((p) => flat(p).y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;

    // A route whose points all coincide has no extent to scale to. Zero is the
    // honest scale for it: everything lands in the middle, which is where it is.
    const s =
      w > 0 || h > 0
        ? Math.min(
            w > 0 ? (SKETCH_W - 2 * SKETCH_PAD) / w : Number.POSITIVE_INFINITY,
            h > 0 ? (SKETCH_H - 2 * SKETCH_PAD) / h : Number.POSITIVE_INFINITY,
          )
        : 0;

    const project = (p: Point) => {
      const f = flat(p);
      return {
        x: (SKETCH_W - w * s) / 2 + (f.x - minX) * s,
        y: (SKETCH_H - h * s) / 2 + (f.y - minY) * s,
      };
    };

    const line = track
      .map((p) => {
        const q = project(p);
        return `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
      })
      .join(" ");

    return { project, line };
  }, [track]);
}

export function ClockNudge({
  file,
  plan,
  track,
  clockOffsetMs,
  onNudge,
}: Readonly<{
  file: File;
  plan: ExtractionPlan;
  track: readonly TrackPoint[];
  clockOffsetMs: number;
  onNudge: (offsetMs: number) => void;
}>) {
  const t = useTranslations("collect");
  const [offset, setOffset] = useState(clockOffsetMs);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // The same two derivations the engine ran, from the same two inputs.
  const derivedStartMs = useMemo(
    () =>
      deriveVideoStartMs(
        { name: file.name, size: file.size, lastModified: file.lastModified },
        plan,
      ),
    [file, plan],
  );
  const firstFrameOffsetMs = useMemo(() => sampleTargetsMs(plan)[0] ?? 0, [plan]);

  const previewT = derivedStartMs + offset + firstFrameOffsetMs;
  const position = interpolateAt(track, previewT);
  const sketch = useSketch(track);

  /**
   * Point the element at the file.
   *
   * An effect assigning `src` on the DOM node rather than a state holding an
   * object URL rendered as a prop, and the same call `LiveRecorder` makes for
   * `srcObject`: this is the "synchronise with an external system" case effects
   * exist for, and routing it through state would be a setState in an effect
   * body for no gain. The URL is a handle on a file that can be gigabytes, so it
   * is revoked on the way out, and the element is unpointed first: revoking a URL
   * a live element still holds is how you get a media error on unmount.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const created = URL.createObjectURL(file);
    video.src = created;
    return () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(created);
    };
  }, [file]);

  // Commit the rested value. Cleared on every change, so a drag writes once.
  useEffect(() => {
    if (offset === clockOffsetMs) return;
    const timer = window.setTimeout(() => onNudge(offset), COMMIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [offset, clockOffsetMs, onNudge]);

  return (
    <Plate className="flex flex-col gap-4 p-4">
      <div>
        <Eyebrow>{t("clock.eyebrow")}</Eyebrow>
        <p className="mt-1.5 text-[13px] font-semibold text-ink">{t("clock.title")}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-neutral-strong">{t("clock.body")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="clock-nudge" className="text-[12px] font-medium text-ink">
            {t("clock.label")}
          </label>
          <output
            htmlFor="clock-nudge"
            className="font-mono text-[13px] tabular-nums text-ink-display"
          >
            {t("clock.seconds", { seconds: Math.round(offset / 1000) })}
          </output>
        </div>
        <input
          id="clock-nudge"
          type="range"
          min={-RANGE_MS}
          max={RANGE_MS}
          step={STEP_MS}
          value={offset}
          onChange={(event) => setOffset(Number(event.target.value))}
          // The thumb is ink, not pink: a slider is not a CTA, an active state,
          // or the LIVE dot, and those are the only three things pink is for.
          className="w-full accent-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <button
          type="button"
          onClick={() => setOffset(0)}
          disabled={offset === 0}
          className="self-start rounded-[4px] border border-border-strong px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none disabled:opacity-50"
        >
          {t("clock.reset")}
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Eyebrow>{t("clock.previewEyebrow")}</Eyebrow>
        <p className="text-[12px] leading-relaxed text-neutral-strong">{t("clock.previewBody")}</p>

        <div className="grid grid-cols-2 gap-2">
          {/* A <video> of an uploaded file is not map tiles, so: plate, hairline,
              no glass. Muted and playsInline so no phone hijacks it fullscreen. */}
          <video
            ref={videoRef}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedMetadata={(event) => {
              // Seek once, to the offset the first sample was taken at. The
              // element clamps a seek past its own end, which is the right
              // behaviour for a thumbnail and needs no guard.
              event.currentTarget.currentTime = firstFrameOffsetMs / 1000;
            }}
            className="aspect-[4/3] w-full rounded-[4px] border border-border bg-surface-sunken object-cover"
          />

          {sketch ? (
            <svg
              viewBox={`0 0 ${SKETCH_W} ${SKETCH_H}`}
              aria-hidden="true"
              className="aspect-[4/3] w-full rounded-[4px] border border-border bg-surface-sunken"
            >
              <polyline
                points={sketch.line}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-current text-neutral"
              />
              {position ? (
                <g>
                  <circle
                    cx={sketch.project(position).x}
                    cy={sketch.project(position).y}
                    r={5}
                    className="fill-current text-surface"
                  />
                  <circle
                    cx={sketch.project(position).x}
                    cy={sketch.project(position).y}
                    r={3}
                    className="fill-current text-ink-display"
                  />
                </g>
              ) : null}
            </svg>
          ) : null}
        </div>

        {position ? (
          <p className="font-mono text-[12px] tabular-nums text-ink" role="status">
            {t("clock.position", {
              lat: position.lat.toFixed(5),
              lng: position.lng.toFixed(5),
            })}
          </p>
        ) : (
          <Notice tone="warn" title={t("clock.outsideTitle")}>
            {t("clock.outsideBody")}
          </Notice>
        )}
      </div>
    </Plate>
  );
}
