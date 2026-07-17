"use client";

/**
 * The front door of the uploaded-video path: pick a file, and be told the truth
 * about what happens next.
 *
 * WHY THE ROUTE PARAGRAPH IS ABOVE THE FOLD. The single most likely way this
 * flow disappoints someone is that they upload a video, wait through minutes of
 * decoding, and only then learn they have to draw the line they walked. Putting
 * that at the end would be a bait. So it is stated before the picker, as a
 * requirement rather than a caveat, and it is stated with its cause: a phone
 * video carries no GPS track and browsers hand a web page nothing but pixels.
 * There is no auto-detection here that sometimes fails. There was never anything
 * to detect. Copy that says "we could not detect the route" would invite the
 * contributor to go looking for the setting that would have let us, and there is
 * no such setting.
 *
 * WHY THE DROP TARGET GROWS AT sm+. This is the one screen of the capture flow
 * that is genuinely more likely to be used on a desktop than a phone: the video
 * is usually already on a laptop by the time somebody thinks about uploading it,
 * and drag-and-drop is the gesture that surface expects. The `<input type=file>`
 * stays the real control underneath, because a drop zone alone is unreachable by
 * keyboard and invisible to a screen reader. The drop handlers are an
 * enhancement layered on top of a working label-plus-input, never a replacement.
 *
 * NO GLASS. The design direction allows backdrop-blur over live map tiles only.
 * There are no tiles on this screen, so everything here is `Plate` plus a
 * hairline. Flash pink appears exactly once: the CTA fill.
 */

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileVideo, MapPin, Route } from "lucide-react";
import { Action, Eyebrow, Notice, Plate, Screen } from "@/components/capture/ui";
import { cn } from "@/components/ui/cn";
import type { VideoError } from "@/components/capture/hooks/useVideoUpload";
import { videoErrorKeys } from "@/components/capture/screens/video/error-keys";

export function VideoStartScreen({
  onPick,
  onBack,
  error,
  durable,
}: Readonly<{
  onPick: (file: File) => void;
  onBack?: () => void;
  error: VideoError | null;
  durable: boolean;
}>) {
  const t = useTranslations("collect");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const errorKeys = videoErrorKeys(error?.reason);

  const take = (files: FileList | null) => {
    const picked = files?.[0];
    if (picked) onPick(picked);
  };

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("videoStart.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("videoStart.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("videoStart.lead")}
        </p>
      </header>

      {errorKeys ? (
        <Notice tone="stop" title={t(errorKeys.title)}>
          {t(errorKeys.body)}
        </Notice>
      ) : null}

      {/* The requirement, not a caveat, and never behind a disclosure. */}
      <Notice tone="warn" title={t("videoStart.routeTitle")}>
        {t("videoStart.routeBody")}
      </Notice>

      {!durable ? <Notice tone="warn">{t("hud.notDurable")}</Notice> : null}

      {/* A label wrapping the input is the whole control: click, tap, Enter and
          Space all reach it for free. The drop handlers only widen the target. */}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed p-6 text-center",
          "sm:p-10",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ink focus-within:ring-offset-2 focus-within:ring-offset-surface",
          dragging ? "border-ink-display bg-surface-sunken" : "border-border-strong bg-surface-elevated",
        )}
      >
        <FileVideo aria-hidden="true" className="size-6 text-ink-muted" strokeWidth={1.5} />
        <span className="text-[14px] font-medium text-ink">{t("videoStart.drop")}</span>
        <span className="text-[12px] leading-relaxed text-neutral-strong">
          {t("videoStart.dropHint")}
        </span>
        <input
          ref={inputRef}
          data-testid="video-file-input"
          type="file"
          accept="video/*"
          // Off-screen rather than `hidden`: a display:none input is skipped by
          // some assistive tech and cannot take focus, and this input IS the
          // control. The label above is its visible body.
          className="absolute size-0 opacity-0"
          onChange={(event) => {
            take(event.target.files);
            // Clearing lets the same file be re-picked after a discard, which
            // otherwise fires no change event at all.
            event.target.value = "";
          }}
        />
      </label>

      <Plate className="p-4">
        <Eyebrow>{t("videoStart.howEyebrow")}</Eyebrow>
        <ol className="mt-3 flex list-none flex-col gap-2">
          {[t("videoStart.how1"), t("videoStart.how2"), t("videoStart.how3")].map((line, i) => (
            <li key={line} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink">
              <span
                className="mt-px font-mono text-[12px] tabular-nums text-ink-faint"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
        <ul className="mt-4 flex list-none flex-col gap-2 border-t border-border pt-3">
          <li className="flex items-center gap-2 text-[12px] text-neutral-strong">
            <Route aria-hidden="true" className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
            {t("videoRoute.gpxTitle")}
          </li>
          <li className="flex items-center gap-2 text-[12px] text-neutral-strong">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
            {t("videoRoute.traceTitle")}
          </li>
        </ul>
      </Plate>

      <div className="flex flex-col gap-3">
        <Action variant="accent" onClick={() => inputRef.current?.click()}>
          {t("videoStart.cta")}
        </Action>
        {onBack ? (
          <Action variant="ghost" onClick={onBack}>
            {t("videoStart.back")}
          </Action>
        ) : null}
        <p className="text-[12px] leading-relaxed text-neutral-strong">{t("videoStart.privacy")}</p>
      </div>
    </Screen>
  );
}
