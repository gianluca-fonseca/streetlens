"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ScoreLayer } from "@/lib/segments";
import {
  BINS,
  COMMUNITY_CASING,
  sampleRamp,
  widthForValue,
} from "@/components/mapConfig";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Legend with explicit value bins (never color-only encoding). Each row pairs
 * the color swatch with a width cue, and the width channel is explained in one
 * line so it does not read as noise.
 *
 * The swatches follow the THEME, because the ramp does (mapConfig rev 8: one
 * half of the table per basemap). Reading `resolved` here rather than styling
 * the swatch in CSS is what keeps the legend and the map the same colour — the
 * swatch is a sample of the ramp, not a decoration that resembles it.
 *
 * On phones the legend is collapsible via a chip toggle (map real estate is
 * scarce); it starts collapsed and the body reveals on tap. On desktop it is
 * always open exactly as before — the toggle chrome is `md:hidden` and the body
 * carries `md:block`, so the sealed desktop layout is untouched.
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
  const { resolved } = useTheme();
  const [open, setOpen] = useState(false);
  // Body is shown when the user opens it (mobile) OR always on desktop.
  const bodyClass = open ? "block" : "hidden md:block";

  return (
    <div>
      {/* items-center below md so the 44px toggle and the scale hint centre
          against each other; md+ keeps the original baseline alignment. */}
      <div className="mb-2 flex items-center justify-between gap-2 md:items-baseline">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          // Measured at 390x844: the visible chip was 69.2x16.5 (es 77.5x16.5),
          // a quarter of the 44px tap floor, and on a phone this is the only
          // route to the colour key.
          //
          // A pseudo-element hit band was tried first, to avoid disturbing the
          // baseline-aligned row. It does not work here: the whole legend sits
          // inside the aside's `.collapsibleInner`, which is `overflow: hidden`
          // for the height animation, and with the legend closed this header IS
          // essentially all of that box — so the band was clipped away above
          // and below and only the visible 16.5px stayed tappable. That failure
          // is invisible to getBoundingClientRect, which never reports a
          // pseudo-element; it took a hit test to see.
          //
          // So the button takes a real 44px instead, and the row switches to
          // items-center below md to keep it aligned with the scale hint. At
          // md+ the legend is always open and this button is
          // `pointer-events-none`, so the desktop layout is untouched.
          className="flex items-center gap-1.5 max-md:min-h-[44px] md:pointer-events-none"
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
                backgroundColor: sampleRamp(layer, bin.mid, resolved),
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
    </div>
  );
}
