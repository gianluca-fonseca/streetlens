"use client";

import { useTranslations } from "next-intl";
import { Accessibility, Bike, Droplets, Route, TreePine } from "lucide-react";
import type { ScoreLayer } from "@/lib/segments";
import { LAYER_ORDER } from "@/components/mapConfig";
import styles from "@/components/ui/zen.module.css";

/**
 * Flat segmented switcher (rev-5: near-flat paper, no neumorphism). Passes
 * affordance rules — every option has a 1px hairline and a text label (not
 * icon-only), the active option adds a paper-white background step + a hairline
 * and carries the pink signal on its icon (the one "active layer" signal), and
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
      className="grid grid-cols-2 gap-1.5 rounded-[8px] border border-border bg-surface-sunken p-1.5"
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
              "flex items-center gap-2 rounded-[4px] border px-2.5 py-2 text-left text-[13px] font-medium",
              styles.control,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-surface-sunken",
              // Active step carries structure via hairline + bg only — NO zen-soft
              // shadow here: this sits ON the glass MapPanel, and shadow is a
              // flat-ground device that muddies over glass (dossier §2/§6).
              isActive
                ? "border-border-strong bg-surface-elevated text-ink"
                : "border-transparent bg-transparent text-neutral-strong hover:border-border hover:bg-surface-elevated/60 hover:text-ink",
            ].join(" ")}
          >
            <Icon
              size={16}
              strokeWidth={1.75}
              className={isActive ? "text-accent" : "text-neutral-strong"}
              aria-hidden="true"
            />
            <span className="truncate">{t(`${layer}.name`)}</span>
          </button>
        );
      })}
    </div>
  );
}
