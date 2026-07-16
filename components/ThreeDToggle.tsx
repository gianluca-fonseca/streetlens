"use client";

import { useTranslations } from "next-intl";
import { Box } from "lucide-react";
import styles from "@/components/ui/zen.module.css";

/**
 * Small 3D view toggle — design-direction compliant micro-control that sits
 * near the layer switcher. Not a neumorphic surface: a single 8px panel with a
 * 1px border (≥3:1) plus a clear on/off background step, one Lucide icon at the
 * shared stroke weight, and a text label (never icon-only). 3D is presentational
 * (terrain + pitch + buildings); it changes no data or scores.
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
        "pointer-events-auto flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] font-medium",
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
