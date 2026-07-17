"use client";

/**
 * Small shared pieces for the recorder screens.
 *
 * Sealed-design notes that apply to everything in `components/capture/`:
 *
 * - Glass is for live map tiles ONLY. The recording HUD floats over a camera
 *   preview, which is video, not tiles, so it uses solid plates plus a hairline.
 *   The one place glass is legal here is the review mini-map (`TrackMiniMap`).
 * - Flash pink is signal-only: the REC dot and the single primary CTA. It is
 *   never a wash, never a border, never body text.
 * - Radii are 2/4/6 and nothing else.
 */

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import styles from "@/components/ui/zen.module.css";

/**
 * A full-height screen that owns its own scroll.
 *
 * The body is `overflow-hidden` and a flex column (see `app/[locale]/layout.tsx`),
 * so every page has to claim its own scroll container as a flex child. `min-h-0`
 * is not optional: without it a flex child refuses to shrink and the overflow
 * never engages.
 */
export function Screen({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-5 py-8 pb-safe">
        {children}
      </div>
    </div>
  );
}

/** Mono caps eyebrow. The only positive-tracked uppercase element in the system. */
export function Eyebrow({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-ink-muted">
      {children}
    </p>
  );
}

/**
 * A labelled figure.
 *
 * Numerals are mono and tabular so a counting HUD does not jitter its own
 * layout on every tick.
 */
export function Stat({
  label,
  value,
  tone = "ink",
}: Readonly<{ label: ReactNode; value: ReactNode; tone?: "ink" | "muted" }>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[22px] tabular-nums leading-none tracking-[-0.01em]",
          tone === "ink" ? "text-ink-display" : "text-neutral-strong",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export type NoticeTone = "neutral" | "warn" | "stop";

/**
 * An honest state, rendered in place and left there.
 *
 * Deliberately not a toast. Every one of these says something the walker needs
 * to still be able to read ten seconds later: the GPS is weak, the screen may
 * sleep, the upload backend is not live. A message that vanishes on a timer is
 * a message you cannot act on while walking.
 *
 * Tone is carried by a left rule and the label, never by a coloured wash: pink
 * is signal-only and the palette is otherwise pure black and white.
 */
export function Notice({
  tone = "neutral",
  title,
  children,
}: Readonly<{ tone?: NoticeTone; title?: ReactNode; children: ReactNode }>) {
  return (
    <div
      className={cn(
        "rounded-[4px] border border-border bg-surface-elevated p-3",
        "border-l-[3px]",
        tone === "neutral" && "border-l-border-strong",
        tone === "warn" && "border-l-ink-display",
        tone === "stop" && "border-l-accent",
      )}
      role={tone === "neutral" ? undefined : "status"}
    >
      {title ? <p className="text-[13px] font-semibold text-ink">{title}</p> : null}
      <p className={cn("text-[13px] leading-relaxed text-neutral-strong", title ? "mt-1" : null)}>
        {children}
      </p>
    </div>
  );
}

/** The pulsing REC dot. One of the two sanctioned uses of flash pink on this page. */
export function LiveDot({ live }: Readonly<{ live: boolean }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-[8px] rounded-full",
        live ? "sl-live-dot" : "bg-ink-faint",
      )}
    />
  );
}

const BUTTON_BASE =
  "inline-flex w-full items-center justify-center gap-2 rounded-[6px] border px-4 py-3 text-[15px] font-medium " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:pointer-events-none disabled:opacity-50";

/**
 * Recorder CTA.
 *
 * Not `components/ui/Button`: that one is the public-surface primitive, sized for
 * a page and rendering a locale-aware Link. These are full-width thumb targets on
 * a phone held one-handed mid-walk. Variants map to the same sealed tokens.
 */
export function Action({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: Readonly<{
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "accent" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        styles.controlSoft,
        BUTTON_BASE,
        variant === "primary" && "border-ink-display bg-ink-display text-surface hover:opacity-90",
        // Hover lightens by opacity only. Darkening to accent-strong would drop
        // the fixed black label below AA on the pink fill.
        variant === "accent" && "border-accent-strong bg-accent text-accent-fg hover:opacity-90",
        variant === "ghost" &&
          "border-border-strong bg-transparent text-ink hover:bg-surface-sunken",
      )}
    >
      {children}
    </button>
  );
}

/** A solid plate. Used instead of glass wherever the backdrop is not map tiles. */
export function Plate({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div
      className={cn(
        styles.plate,
        "rounded-[4px] border border-border bg-surface-elevated",
        className,
      )}
    >
      {children}
    </div>
  );
}
