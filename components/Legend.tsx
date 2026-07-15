"use client";

import { useTranslations } from "next-intl";
import type { ScoreLayer } from "@/lib/segments";
import {
  BINS,
  COMMUNITY_CASING,
  sampleRamp,
  widthForValue,
} from "@/components/mapConfig";

/**
 * Always-visible legend with explicit value bins (never color-only encoding).
 * Each row pairs the color swatch with a width cue, and the width channel is
 * explained in one line so it does not read as noise.
 */
export default function Legend({
  layer,
  communitySegments,
}: Readonly<{
  layer: ScoreLayer;
  /** Count of community/import segments in the current data; drives the extra entry. */
  communitySegments: number;
}>) {
  const t = useTranslations("legend");
  const tl = useTranslations("layers");

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-strong">
          {t("title")}
        </h3>
        <span className="font-mono text-[10px] text-neutral-strong">
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
            <span className="ml-auto font-mono text-[11px] text-neutral-strong">
              {bin.min}–{bin.max}
            </span>
          </li>
        ))}
      </ul>

      {communitySegments > 0 && (
        <div className="mt-2.5 flex items-center gap-2.5 border-t border-border pt-2">
          <svg
            width={22}
            height={COMMUNITY_CASING.width}
            className="shrink-0"
            aria-hidden="true"
          >
            <line
              x1={0}
              y1={COMMUNITY_CASING.width / 2}
              x2={22}
              y2={COMMUNITY_CASING.width / 2}
              stroke={COMMUNITY_CASING.color}
              strokeWidth={COMMUNITY_CASING.width}
              strokeDasharray={COMMUNITY_CASING.dash.join(" ")}
            />
          </svg>
          <span className="text-[12px] font-medium text-ink">
            {t("community")}
          </span>
        </div>
      )}

      <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-snug text-neutral-strong">
        {t("widthNote")}
      </p>
    </div>
  );
}
