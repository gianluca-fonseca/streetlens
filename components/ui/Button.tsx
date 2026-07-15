import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/components/ui/cn";

/**
 * The one CTA primitive for the public surface. Three variants keyed to the
 * sealed palette; all clear AA with their foreground. Renders as a locale-aware
 * <Link> for internal routes, a plain <a> for same-page hash anchors, or a
 * <button> otherwise. Radius stays inside the 4/8/12 system (8px control).
 */
export type ButtonVariant = "pine" | "terracotta" | "ghost";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[8px] border font-medium " +
  "transition-[opacity,transform,background-color,border-color] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  // Deep pine reads AA against white in both light and dark token sets.
  pine: "border-pine-strong bg-pine-strong text-white hover:opacity-90",
  // Terracotta needs dark ink for AA; the accent stays legible either mode.
  terracotta: "border-terracotta bg-terracotta text-ink hover:opacity-90",
  ghost: "border-border-strong bg-transparent text-ink hover:bg-surface-sunken",
};

const SIZES: Record<ButtonSize, string> = {
  md: "px-4 py-2 text-[0.95rem]",
  lg: "px-5 py-2.5 text-[1rem]",
};

export default function Button({
  children,
  href,
  onClick,
  variant = "pine",
  size = "md",
  className,
  type = "button",
  target,
  rel,
  "aria-label": ariaLabel,
}: Readonly<{
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  type?: "button" | "submit";
  target?: string;
  rel?: string;
  "aria-label"?: string;
}>) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className);

  if (href !== undefined) {
    // Same-page anchors keep the native <a> so no locale prefix is injected.
    if (href.startsWith("#")) {
      return (
        <a
          href={href}
          className={classes}
          onClick={onClick}
          target={target}
          rel={rel}
          aria-label={ariaLabel}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className={classes}
        onClick={onClick}
        target={target}
        rel={rel}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
