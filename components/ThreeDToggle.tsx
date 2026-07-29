"use client";

import { useTranslations } from "next-intl";
import { Box } from "lucide-react";
import styles from "@/components/ui/zen.module.css";

/**
 * The map's single dimensional-view toggle — design-direction compliant
 * micro-control that sits near the layer switcher. Not a neumorphic surface: a
 * single 8px panel with a 1px border (≥3:1) plus a clear on/off background step,
 * one Lucide icon at the shared stroke weight, and a text label (never
 * icon-only).
 *
 * "3D view" means ONE thing: the score relief, the network's quality standing
 * up off the plan, over a pitched camera. It used to mean DEM terrain plus
 * building extrusions, which is a different picture wearing the same words; the
 * relief kept the label and the terrain mode was retired (see the dimensional
 * view block in AuditMap.tsx for the reasoning). It still changes no data and no
 * scores: it decides whether the score is drawn as height as well as colour and
 * width.
 *
 * `active` is seeded from a server-resolved cookie, so this button's very first
 * render already tells the truth about what the map is doing.
 */
export default function ThreeDToggle({
  active,
  onToggle,
}: Readonly<{
  active: boolean;
  onToggle: (next: boolean) => void;
}>) {
  const t = useTranslations("map.threeD");

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? t("disable") : t("enable")}
      onClick={() => onToggle(!active)}
      className={[
        // 98.1x37.5 measured at 390x844 (es 101.3x37.5). Growing this control
        // changes the map column's height budget, so AuditMap's reserve comment
        // was re-measured with it: see the `pb-16` / `sm:pb-14` note there.
        "pointer-events-auto flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] font-medium pointer-coarse:min-h-[44px]",
        styles.control,
        styles.enterChip,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
        active
          ? "border border-ink-display bg-ink-display text-surface shadow-[0_2px_8px_rgba(0,0,0,0.16)]"
          : `${styles.glassChip} text-ink hover:border-border-strong`,
      ].join(" ")}
    >
      <Box
        size={16}
        strokeWidth={1.75}
        className={active ? "text-surface" : "text-ink-muted"}
        aria-hidden="true"
      />
      <span>{t("label")}</span>
    </button>
  );
}
