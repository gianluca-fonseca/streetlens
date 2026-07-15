import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Earned glass (design-direction rev 3): a floating surface for IMAGERY-BACKED
 * contexts only — over the live map, over a rendered map render, or over the
 * dark field renders. Backdrop-blur with a warm bone tint (`--glass-bg`) and a
 * warm hairline (`--glass-border`), both theme-adaptive so one primitive reads
 * over light and warm-dark imagery alike. Never place this on a flat surface,
 * and never stack it glass-on-glass — that is the banned glassmorphism. Text
 * inside stays AA: the tint sits at ~0.62–0.72 opacity so ink holds contrast.
 */
export default function GlassPanel({
  children,
  className,
  radius = "panel",
  elevation = "popover",
  as: Tag = "div",
}: Readonly<{
  children: ReactNode;
  className?: string;
  radius?: "panel" | "primary";
  elevation?: "panel" | "popover";
  as?: "div" | "section" | "article" | "aside";
}>) {
  return (
    <Tag
      className={cn(
        "border bg-[var(--glass-bg)] backdrop-blur-md",
        "border-[color:var(--glass-border)]",
        radius === "primary" ? "rounded-[12px]" : "rounded-[8px]",
        elevation === "popover"
          ? "shadow-[var(--shadow-popover)]"
          : "shadow-[var(--shadow-panel)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
