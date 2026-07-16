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

/** The rev-5 inverted-paper token values, applied inline so `tone="inverted"` is
 * theme-independent and every shared primitive reads correctly on it. Mirrors the
 * dark @media block in globals.css. --accent-fg is left at its light value
 * (#0c0a06) so the pink fills keep their AA label on the negative. */
const INVERTED_TOKENS: CSSProperties = {
  ["--paper" as string]: "#14120c",
  ["--paper-white" as string]: "#1e1b14",
  ["--paper-sunken" as string]: "#0d0b07",
  ["--surface-base" as string]: "#14120c",
  ["--surface-elevated" as string]: "#1e1b14",
  ["--surface-sunken" as string]: "#0d0b07",
  ["--ink" as string]: "#f1eee3",
  ["--ink-display" as string]: "#fbf9f0",
  ["--ink-muted" as string]: "#a69e8c",
  ["--ink-faint" as string]: "#6e6656",
  ["--neutral-strong" as string]: "#a69e8c",
  ["--neutral" as string]: "#6e6656",
  ["--neutral-soft" as string]: "#33302a",
  ["--hairline" as string]: "#33302a",
  ["--hairline-strong" as string]: "#4c483f",
  ["--border" as string]: "#33302a",
  ["--border-strong" as string]: "#4c483f",
  ["--pine" as string]: "#f1eee3",
  ["--pine-strong" as string]: "#fbf9f0",
  ["--accent" as string]: "#ff4fa3",
  ["--accent-strong" as string]: "#ff77b8",
  ["--accent-text" as string]: "#ff6fb0",
  ["--terracotta" as string]: "#ef8f56",
  ["--ring" as string]: "#f1eee3",
  ["--glass-bg" as string]: "rgba(20, 18, 12, 0.72)",
  ["--glass-border" as string]: "rgba(241, 238, 227, 0.14)",
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
