import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Section rhythm primitive. Owns vertical spacing and the centered content
 * measure so every block breathes consistently. The "field" tone is the single
 * sanctioned brand evolution: a warm near-black stretch (the dark-mode surface
 * values, applied regardless of OS theme) for the honest-stat block.
 */
export type SectionTone = "bone" | "sunken" | "field";

const TONES: Record<SectionTone, string> = {
  bone: "bg-surface text-ink",
  sunken: "bg-surface-sunken text-ink",
  // Dark asphalt field: the token overrides below turn every child primitive
  // dark (ink, neutrals, borders, pine, accent) without any per-child theming.
  field: "bg-surface text-ink",
};

/** The sealed dark-mode token values (rev 4: asphalt green-black), applied
 * inline so `tone="field"` is theme-independent and the shared primitives read
 * correctly on it. Mirrors the dark @media block in globals.css. */
const FIELD_TOKENS: CSSProperties = {
  ["--surface-base" as string]: "#10130f",
  ["--surface-elevated" as string]: "#191d17",
  ["--surface-sunken" as string]: "#0b0e0a",
  ["--ink" as string]: "#e8ebe0",
  ["--neutral-strong" as string]: "#a4a99c",
  ["--neutral" as string]: "#78806f",
  ["--neutral-soft" as string]: "#333a2e",
  ["--pine" as string]: "#3f9c7f",
  ["--pine-strong" as string]: "#2c7a62",
  // Yellow accent reads directly on asphalt; accent-text folds to the saturated
  // form here (~10:1 on the field grounds).
  ["--accent" as string]: "#e8c51c",
  ["--accent-strong" as string]: "#f0d23a",
  ["--accent-text" as string]: "#e8c51c",
  ["--terracotta" as string]: "#ef8f56",
  ["--border" as string]: "#333a2e",
  ["--border-strong" as string]: "#4a5142",
  // Glass over dark renders inside a field section: asphalt tint + light hairline.
  ["--glass-bg" as string]: "rgba(16, 19, 15, 0.62)",
  ["--glass-border" as string]: "rgba(232, 235, 224, 0.14)",
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

  // Flat marketing grounds (bone/sunken) carry the topographic contour motif;
  // the dark "field" tone runs its own imagery, so it opts out.
  const textured = tone === "bone" || tone === "sunken";

  return (
    <section
      id={id}
      style={tone === "field" ? FIELD_TOKENS : undefined}
      className={cn(pad, TONES[tone], textured && "contour-field", className)}
    >
      {inner}
    </section>
  );
}
