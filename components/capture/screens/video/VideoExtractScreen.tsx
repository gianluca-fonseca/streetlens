"use client";

/**
 * Minutes of decoding, made legible.
 *
 * WHY THE SPARSER NOTICE IS NOT A FOOTNOTE. `planExtraction` stretches the
 * sampling interval when a video would blow the 400 frame cap at one frame a
 * second, and that is a decision made ON THE CONTRIBUTOR'S BEHALF about their
 * own walk. A twenty minute video gets a frame every three seconds. They should
 * hear that from us, in the moment it happens, together with the reason it is
 * the right call: the alternative is not "more frames", it is covering the first
 * seven minutes of the street and abandoning the rest. So the notice states the
 * interval, states that the whole street is still covered, and does not
 * apologise, because there is nothing to apologise for.
 *
 * WHY THE DECODER IS A DIAGNOSTIC AND NOT A WARNING. Which of the two readers
 * ran is a property of the browser, not of the evidence. Both produce the same
 * artifact through the same encoder and the same plan, and the server is never
 * told which one it was. Presenting "we fell back to the slow path" as a problem
 * would be inventing a fault out of a working code path, and it would push
 * people toward changing browser for no gain. So it sits at the bottom as a mono
 * caps line, next to nothing, for the one person who is debugging.
 *
 * WHY STORAGE-FULL LANDS HERE. `useVideoUpload` aborts the extraction on a quota
 * error, and an abort leaves the phase where it was. This screen is therefore
 * the last thing on screen when the disk fills, and if it did not say so the
 * contributor would watch a progress bar that had silently stopped forever. The
 * notice is in place and permanent, with the honest consequence attached: the
 * frames read so far are still here, and discarding is a real choice.
 *
 * NO GLASS. There are no map tiles on this screen.
 */

import { useTranslations } from "next-intl";
import { Action, Eyebrow, Notice, Plate, Screen, Stat } from "@/components/capture/ui";
import type { DecodePath } from "@/components/capture/hooks/useVideoUpload";
import type { ExtractionPlan } from "@/components/capture/engine/video-plan";

/** The bar. `role="progressbar"` because a div of two divs announces nothing. */
function ProgressBar({
  value,
  max,
  label,
}: Readonly<{ value: number; max: number; label: string }>) {
  // A plan can target zero frames only on a video too short to sample, and that
  // never reaches this screen. Guarding anyway: a NaN width silently renders an
  // empty bar that looks like no progress rather than like a bug.
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-[6px] w-full overflow-hidden rounded-[2px] border border-border bg-surface-sunken"
    >
      <div
        // Ink, not pink. Flash pink is signal-only: a CTA fill, an active state,
        // the LIVE dot. A progress bar is none of those.
        className="h-full bg-ink-display transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function VideoExtractScreen({
  probing,
  plan,
  framesKept,
  decodePath,
  storageFull,
  onDiscard,
}: Readonly<{
  probing: boolean;
  plan: ExtractionPlan | null;
  framesKept: number;
  decodePath: DecodePath | null;
  storageFull: boolean;
  onDiscard: () => void;
}>) {
  const t = useTranslations("collect");
  const target = plan?.targetFrames ?? 0;

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("videoExtract.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("videoExtract.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {probing || !plan ? t("videoExtract.probing") : t("videoExtract.lead")}
        </p>
      </header>

      {storageFull ? (
        <Notice tone="stop" title={t("videoExtract.storageFullTitle")}>
          {t("videoExtract.storageFullBody")}
        </Notice>
      ) : null}

      {plan?.sparser ? (
        <Notice tone="warn" title={t("videoExtract.sparserTitle")}>
          {t("videoExtract.sparserBody", { seconds: Math.round(plan.intervalMs / 1000) })}
        </Notice>
      ) : null}

      {plan ? (
        <Plate className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-2 gap-4">
            <Stat label={t("videoExtract.frames")} value={framesKept} />
            <Stat label={t("videoExtract.planned")} value={target} tone="muted" />
          </div>
          <ProgressBar
            value={framesKept}
            max={target}
            label={t("videoExtract.progress", { kept: framesKept, target })}
          />
          <p className="font-mono text-[12px] tabular-nums text-neutral-strong" role="status">
            {t("videoExtract.progress", { kept: framesKept, target })}
          </p>
        </Plate>
      ) : null}

      <Notice>{t("videoExtract.keepOpen")}</Notice>

      <div className="flex flex-col gap-3">
        <Action variant="ghost" onClick={onDiscard}>
          {t("videoExtract.discard")}
        </Action>
        {decodePath ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {t("videoExtract.pathEyebrow")} {t(`videoExtract.path_${decodePath}`)}
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
