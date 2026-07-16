import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The manifesto band. Owns the document's vertical rhythm and, optionally, the
 * column-width hairline rule that separates one numbered section from the next.
 * It is full-bleed by design: each block inside picks its own measure via the
 * <Measure> primitive (text / outset / page / screen), so a centered 68ch thesis
 * and a page-width figure can share one band.
 *
 * `tone="inverted"` is the single sanctioned brand stretch: the same document as
 * a letterpress negative (the dark-mode token values, applied regardless of OS
 * theme). It is reserved for the closing band.
 */
export type SectionTone = "paper" | "sunken" | "inverted";

const TONES: Record<SectionTone, string> = {
  paper: "bg-surface text-ink",
  sunken: "bg-surface-sunken text-ink",
  inverted: "bg-surface text-ink",
};

/** The rev-6 black-zen (negative) token values, applied inline so `tone="inverted"`
 * is theme-independent and every shared primitive reads correctly on it. Mirrors the
 * dark @media block in globals.css. --accent-fg is left at its light value (#000000,
 * pure black) so the pink fills keep their AA label on the negative. */
const INVERTED_TOKENS: CSSProperties = {
  ["--paper" as string]: "#0a0a0a",
  ["--paper-white" as string]: "#141414",
  ["--paper-sunken" as string]: "#050505",
  ["--surface-base" as string]: "#0a0a0a",
  ["--surface-elevated" as string]: "#141414",
  ["--surface-sunken" as string]: "#050505",
  ["--ink" as string]: "#f2f2f2",
  ["--ink-display" as string]: "#ffffff",
  ["--ink-muted" as string]: "#a3a3a3",
  ["--ink-faint" as string]: "#666666",
  ["--neutral-strong" as string]: "#a3a3a3",
  ["--neutral" as string]: "#666666",
  ["--neutral-soft" as string]: "#262626",
  ["--hairline" as string]: "#262626",
  ["--hairline-strong" as string]: "#3d3d3d",
  ["--border" as string]: "#262626",
  ["--border-strong" as string]: "#3d3d3d",
  ["--pine" as string]: "#f2f2f2",
  ["--pine-strong" as string]: "#ffffff",
  ["--accent" as string]: "#ff4fa3",
  ["--accent-strong" as string]: "#ff77b8",
  ["--accent-text" as string]: "#ff6fb0",
  ["--terracotta" as string]: "#ef8f56",
  ["--ring" as string]: "#f2f2f2",
  ["--glass-bg" as string]: "rgba(10, 10, 10, 0.58)",
  ["--glass-border" as string]: "rgba(255, 255, 255, 0.12)",
};

export default function Section({
  children,
  id,
  tone = "paper",
  className,
  spacing = "lg",
  rule = false,
}: Readonly<{
  children: ReactNode;
  id?: string;
  tone?: SectionTone;
  className?: string;
  spacing?: "md" | "lg";
  /** Draw a column-width hairline at the top edge (the between-section rule). */
  rule?: boolean;
}>) {
  const pad = spacing === "lg" ? "py-[3.5rem] sm:py-16" : "py-10 sm:py-12";

  return (
    <section
      id={id}
      style={tone === "inverted" ? INVERTED_TOKENS : undefined}
      className={cn(TONES[tone], className)}
    >
      {rule ? (
        <div className="mx-auto max-w-[42.5rem] px-6">
          <div className="h-px w-full bg-hairline" aria-hidden="true" />
        </div>
      ) : null}
      <div className={pad}>{children}</div>
    </section>
  );
}
