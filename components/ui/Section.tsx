import type { ReactNode } from "react";
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
  // Dark warm field. Values mirror the sealed dark-mode tokens.
  field: "bg-[#14140f] text-[#ecebe0]",
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

  return (
    <section id={id} className={cn(pad, TONES[tone], className)}>
      {inner}
    </section>
  );
}
