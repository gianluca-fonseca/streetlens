"use client";

import { useTranslations } from "next-intl";
import { Eyebrow, Plate } from "@/components/capture/ui";
import { assessUploadReadiness } from "@/lib/capture/pre-upload-gate";
import type { RecorderStats } from "@/components/capture/hooks/useRecorder";
import type { TrackPoint } from "@/lib/capture/types";
import { cn } from "@/components/ui/cn";

const STATUS_CLASS: Record<string, string> = {
  ok: "text-ink",
  warn: "text-neutral-strong",
  block: "text-clay",
};

export function PreUploadGate({
  stats,
  track,
}: Readonly<{
  stats: RecorderStats;
  track: readonly TrackPoint[];
}>) {
  const t = useTranslations("collect.gate");
  const result = assessUploadReadiness({
    framesKept: stats.framesKept,
    dropCounts: stats.dropCounts,
    elapsedMs: stats.elapsedMs,
    track,
    accuracyM: stats.accuracyM,
  });

  return (
    <Plate className="flex flex-col gap-3 p-4">
      <div>
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-strong">{t("lead")}</p>
      </div>
      <dl className="flex flex-col gap-2">
        {result.items.map((item) => (
          <div key={item.id} className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-neutral-strong">{t(`items.${item.id}.label`)}</dt>
            <dd className={cn("font-mono text-[13px] tabular-nums", STATUS_CLASS[item.status] ?? "text-ink")}>
              {item.value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="font-mono text-[11px] text-ink-muted">
        {t("coverageEstimate", { meters: Math.round(result.coverageEstimateM) })}
      </p>
      {result.items
        .filter((item) => item.hintKey)
        .map((item) => (
          <p key={`${item.id}-hint`} className="text-[12px] leading-relaxed text-neutral-strong">
            {t(`items.${item.id}.hints.${item.hintKey}` as "items.frames.hints.frames_none")}
          </p>
        ))}
      {result.blocked ? (
        <p className="text-[12px] font-medium text-clay">{t("blocked")}</p>
      ) : (
        <p className="text-[12px] text-neutral-strong">{t("ready")}</p>
      )}
    </Plate>
  );
}
