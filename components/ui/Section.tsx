import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Section rhythm primitive. Owns vertical spacing and the centered content
 * measure so every block breathes consistently. The "field" tone is the single
 * sanctioned brand evolution: an inverted-paper stretch (the dark-mode token
 * values, applied regardless of OS theme) for the honest-stat / closing band.
 */
export type SectionTone = "bone" | "sunken" | "field";

const TONES: Record<SectionTone, string> = {
  bone: "bg-surface text-ink",
  sunken: "bg-surface-sunken text-ink",
  // Inverted-paper field: the token overrides below turn every child primitive
  // dark (ink, neutrals, hairlines, pink accent) without any per-child theming.
  field: "bg-surface text-ink",
};

/** The rev-5 inverted-paper token values, applied inline so `tone="field"` is
 * theme-independent and the shared primitives read correctly on it. Mirrors the
 * dark @media block in globals.css (both the base tokens and the legacy aliases
 * components consume). --accent-fg is deliberately left at its light value
 * (#0c0a06) so the dark pink fills keep their AA label. */
const FIELD_TOKENS: CSSProperties = {
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
  // Interim pine hold (retired brand primary) reads creme-ink on the dark ground.
  ["--pine" as string]: "#f1eee3",
  ["--pine-strong" as string]: "#fbf9f0",
  // Flash pink pops on near-black; accent-text is the light-pink text form.
  ["--accent" as string]: "#ff4fa3",
  ["--accent-strong" as string]: "#ff77b8",
  ["--accent-text" as string]: "#ff6fb0",
  ["--terracotta" as string]: "#ef8f56",
  ["--ring" as string]: "#f1eee3",
  // Glass survivor tint inside a field section: inverted-paper tint + light hairline.
  ["--glass-bg" as string]: "rgba(20, 18, 12, 0.72)",
  ["--glass-border" as string]: "rgba(241, 238, 227, 0.14)",
};

export default function Section({
  children,
  id,
  tone = "bone",
  className,
  containerClassName,
  contained = true,
  spacing = "lg",
}: Readonly<{
  children: ReactNode;
  id?: string;
  tone?: SectionTone;
  className?: string;
  containerClassName?: string;
  /** Set false for full-bleed sections that manage their own layout. */
  contained?: boolean;
  spacing?: "md" | "lg";
}>) {
  const pad = spacing === "lg" ? "py-20 sm:py-28" : "py-14 sm:py-20";
  const inner = contained ? (
    <div className={cn("mx-auto w-full max-w-6xl px-6", containerClassName)}>
      {children}
    </div>
  ) : (
    children
  );

  // rev-5 is flat paper: hairlines carry structure, so no tiled contour texture.
  return (
    <section
      id={id}
      style={tone === "field" ? FIELD_TOKENS : undefined}
      className={cn(pad, TONES[tone], className)}
    >
      {inner}
    </section>
  );
}
