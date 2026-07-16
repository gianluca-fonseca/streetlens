import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The kicker, set in IBM Plex Mono as the instrument voice: 12px caps, +0.12em,
 * `--ink-muted`. It sits above a headline and is never the only hierarchy — the
 * one positive-tracked uppercase element on the page. `tone="accent"` promotes
 * it to accent-text (the deep magenta that clears AA on paper); everything else
 * reads muted (brand pine is retired in rev-5).
 */
export default function Eyebrow({
  children,
  className,
  tone = "muted",
}: Readonly<{
  children: ReactNode;
  className?: string;
  tone?: "muted" | "accent";
}>) {
  return (
    <p
      className={cn(
        "font-mono text-[12px] font-medium uppercase tracking-[0.12em] leading-[1.4]",
        tone === "accent" ? "text-accent-text" : "text-ink-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}
