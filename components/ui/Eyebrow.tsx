import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The section eyebrow, set in IBM Plex Mono as instrument voice (rev 4): the
 * mono face is promoted to a first-class label voice across the product, so
 * eyebrows read like the caption plate on a survey instrument, not a startup
 * kicker. Wide-tracked all-caps. Never the only hierarchy (ban #14): it always
 * pairs with a headline.
 */
export default function Eyebrow({
  children,
  className,
  tone = "pine",
}: Readonly<{
  children: ReactNode;
  className?: string;
  /** "pine" on light grounds; "accent" for the road-marking-yellow highlight
   * (dark-ochre on light, saturated yellow on dark); "muted" for dark fields. */
  tone?: "pine" | "accent" | "muted";
}>) {
  const toneClass =
    tone === "accent"
      ? "text-accent-text"
      : tone === "muted"
        ? "text-neutral-strong"
        : "text-pine";
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.2em]",
        toneClass,
        className,
      )}
    >
      {children}
    </p>
  );
}
