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
  // Dark warm field: the token overrides below turn every child primitive dark
  // (ink, neutrals, borders, pine, terracotta) without any per-child theming.
  field: "bg-surface text-ink",
};

/** The sealed dark-mode token values, applied inline so `tone="field"` is
 * theme-independent and the shared primitives read correctly on it. */
const FIELD_TOKENS: CSSProperties = {
  ["--surface-base" as string]: "#14140f",
  ["--surface-elevated" as string]: "#1e1e17",
  ["--surface-sunken" as string]: "#0f0f0b",
  ["--ink" as string]: "#ecebe0",
  ["--neutral-strong" as string]: "#a9ac9f",
  ["--neutral" as string]: "#7d8175",
  ["--neutral-soft" as string]: "#35352b",
  ["--pine" as string]: "#3f9c7f",
  ["--pine-strong" as string]: "#2c7a62",
  ["--terracotta" as string]: "#ef8f56",
  ["--border" as string]: "#35352b",
  ["--border-strong" as string]: "#4c4c3e",
  // Glass over dark renders inside a field section: warm-dark tint + light hairline.
  ["--glass-bg" as string]: "rgba(20, 20, 15, 0.62)",
  ["--glass-border" as string]: "rgba(236, 235, 224, 0.14)",
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
