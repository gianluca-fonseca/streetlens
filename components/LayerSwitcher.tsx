"use client";

import { useTranslations } from "next-intl";
import { Accessibility, Bike, Droplets, Route, TreePine } from "lucide-react";
import type { ScoreLayer } from "@/lib/segments";
import { LAYER_ORDER } from "@/components/mapConfig";

/**
 * The ONE permitted neumorphic-ish micro-control: a soft segmented switcher.
 * Passes affordance rules — every option has a 1px border and a text label
 * (not icon-only), the active option adds a background step + pine ring, and
 * all labels clear AA contrast. Icons share one Lucide stroke weight.
 */

const ICONS: Record<ScoreLayer, typeof Route> = {
  overall: Route,
  accessibility: Accessibility,
  drainage: Droplets,
  shade: TreePine,
  bike: Bike,
};

export default function LayerSwitcher({
  active,
  onSelect,
}: Readonly<{
  active: ScoreLayer;
  onSelect: (layer: ScoreLayer) => void;
}>) {
  const t = useTranslations("layers");

  return (
    <div
      role="radiogroup"
      aria-label={t("switcherLabel")}
      className="grid grid-cols-2 gap-1.5 rounded-[8px] border border-border bg-surface-sunken p-1.5 shadow-[inset_0_1px_2px_rgba(58,52,40,0.10),inset_0_-1px_1px_rgba(255,255,255,0.35)]"
    >
      {LAYER_ORDER.map((layer) => {
        const Icon = ICONS[layer];
        const isActive = layer === active;
        return (
          <button
            key={layer}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onSelect(layer)}
            className={[
              "flex items-center gap-2 rounded-[4px] border px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1 focus-visible:ring-offset-surface-sunken",
              isActive
                ? "border-border-strong bg-surface-elevated text-ink shadow-[0_1px_2px_rgba(58,52,40,0.12)]"
                : "border-transparent bg-transparent text-neutral-strong hover:border-border hover:bg-surface-elevated/60 hover:text-ink",
            ].join(" ")}
          >
            <Icon
              size={16}
              strokeWidth={1.75}
              className={isActive ? "text-pine" : "text-neutral-strong"}
              aria-hidden="true"
            />
            <span className="truncate">{t(`${layer}.name`)}</span>
          </button>
        );
      })}
    </div>
  );
}
