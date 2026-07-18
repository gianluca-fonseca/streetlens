"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ScoreLayer } from "@/lib/segments";
import {
  BINS,
  COMMUNITY_CASING,
  CV_CASING,
  sampleRamp,
  widthForValue,
} from "@/components/mapConfig";

/**
 * Legend with explicit value bins (never color-only encoding). Each row pairs
 * the color swatch with a width cue, and the width channel is explained in one
 * line so it does not read as noise.
 *
 * On phones the legend is collapsible via a chip toggle (map real estate is
 * scarce); it starts collapsed and the body reveals on tap. On desktop it is
 * always open exactly as before — the toggle chrome is `md:hidden` and the body
 * carries `md:block`, so the sealed desktop layout is untouched.
 */
export default function Legend({
  layer,
  communitySegments,
  cvSegments,
}: Readonly<{
  layer: ScoreLayer;
  /** Count of community/import segments in the current data; drives the extra entry. */
  communitySegments: number;
  /** Count of camera-observed segments; drives the camera-observed entry. */
  cvSegments: number;
}>) {
  const t = useTranslations("legend");
  const tl = useTranslations("layers");
  const [open, setOpen] = useState(false);
  // Body is shown when the user opens it (mobile) OR always on desktop.
  const bodyClass = open ? "block" : "hidden md:block";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 md:pointer-events-none"
        >
          <h3 className="text-[11px] font-mono font-medium uppercase tracking-[0.16em] text-neutral-strong">
            {t("title")}
          </h3>
          <ChevronDown
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            className={[
              "text-neutral-strong transition-transform md:hidden",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>
        <span className="font-mono text-[10px] text-neutral-strong">
          {t("scaleHint")}
        </span>
      </div>

      <div className={bodyClass}>
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

      {cvSegments > 0 && (
        <div className="mt-2.5 flex items-center gap-2.5 border-t border-border pt-2">
          <svg
            width={22}
            height={CV_CASING.width}
            className="shrink-0"
            aria-hidden="true"
          >
            <line
              x1={0}
              y1={CV_CASING.width / 2}
              x2={22}
              y2={CV_CASING.width / 2}
              stroke={CV_CASING.color}
              strokeWidth={CV_CASING.width}
            />
          </svg>
          <span className="text-[12px] font-medium text-ink">
            {t("cameraObserved")}
          </span>
        </div>
      )}

      <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-snug text-neutral-strong">
        {t("widthNote")}
      </p>
      </div>
    </div>
  );
}
