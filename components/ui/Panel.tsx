import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The one repeated soft-depth surface (not glass, not neumorphism). Dual warm
 * shadow + 1px border affordance. Two radii from the sealed scale: 8px cards,
 * 12px reserved for the primary floating panel.
 */
export default function Panel({
  children,
  className,
  radius = "panel",
  elevation = "panel",
  as: Tag = "div",
}: Readonly<{
  children: ReactNode;
  className?: string;
  radius?: "panel" | "primary";
  elevation?: "panel" | "popover";
  as?: "div" | "section" | "article";
}>) {
  return (
    <Tag
      className={cn(
        "border border-border bg-surface-elevated",
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
