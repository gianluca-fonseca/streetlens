import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import styles from "@/components/ui/zen.module.css";

/**
 * Earned glass (design-direction rev 6, "Zen Instrument"): a floating surface for
 * IMAGERY-BACKED contexts ONLY — over the live map tiles. Recipe A (`variant="panel"`)
 * for panels/popovers, Recipe C (`variant="chip"`) for small floating pills. Both
 * carry `saturate()` (never bare blur), an inner-top edge highlight + outer lift
 * shadow, and are theme-adaptive so one primitive reads over light and dark tiles.
 * The blur radius is wired to the `--glass-blur` token (u16 adjudication A1).
 *
 * NEVER place this on a flat ground (use a zen-soft `.plate` there), and NEVER stack
 * it glass-on-glass — a chip inside a glass panel goes solid. The full recipe lives
 * in `zen.module.css`; components may apply those classes directly where wrapping
 * would restructure layout.
 */
export default function GlassPanel({
  children,
  className,
  variant = "panel",
  radius = "panel",
  animateIn = false,
  as: Tag = "div",
}: Readonly<{
  children: ReactNode;
  className?: string;
  variant?: "panel" | "chip";
  radius?: "panel" | "primary" | "pill";
  animateIn?: boolean;
  as?: "div" | "section" | "article" | "aside" | "figcaption";
}>) {
  return (
    <Tag
      className={cn(
        variant === "chip" ? styles.glassChip : styles.glassPanel,
        animateIn && (variant === "chip" ? styles.enterChip : styles.enter),
        radius === "pill"
          ? "rounded-full"
          : radius === "primary"
            ? "rounded-[12px]"
            : "rounded-[8px]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
