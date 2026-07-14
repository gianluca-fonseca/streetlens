"use client";

import { useTranslations } from "next-intl";
import type { ScoreLayer } from "@/lib/segments";
import { BINS, sampleRamp, widthForValue } from "@/components/mapConfig";

/**
 * Always-visible legend with explicit value bins (never color-only encoding).
 * Each row pairs the color swatch with a width cue, and the width channel is
 * explained in one line so it does not read as noise.
 */
export default function Legend({
  layer,
}: Readonly<{
  layer: ScoreLayer;
}>) {
  const t = useTranslations("legend");
  const tl = useTranslations("layers");

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
          {t("title")}
        </h3>
        <span className="font-mono text-[10px] text-neutral">
          {t("scaleHint")}
        </span>
      </div>

      <p className="mb-2 text-[12px] text-neutral-strong">
        {tl(`${layer}.short`)}
      </p>

      <ul className="flex flex-col gap-1.5">
        {BINS.map((bin) => (
          <li key={bin.key} className="flex items-center gap-2.5">
            <span
              className="inline-block shrink-0 rounded-[2px]"
              style={{
                width: 22,
                height: Math.max(3, Math.round(widthForValue(bin.mid))),
                backgroundColor: sampleRamp(layer, bin.mid),
              }}
              aria-hidden="true"
            />
            <span className="text-[12px] font-medium text-ink">
              {t(`bins.${bin.key}`)}
            </span>
            <span className="ml-auto font-mono text-[11px] text-neutral">
              {bin.min}–{bin.max}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-snug text-neutral-strong">
        {t("widthNote")}
      </p>
    </div>
  );
}
