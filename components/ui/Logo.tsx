import { cn } from "@/components/ui/cn";

/**
 * StreetLens logomark + wordmark lockup (u20).
 *
 * The mark is the "scored centerline": a mono-weight S drawn as a street
 * centerline that bends through two turns, terminating in a single flash-pink
 * node — the one sanctioned signal, an audited reading on the street. It is the
 * S-monogram for StreetLens built from a street centerline, and it reads as a
 * pure geometric instrument from favicon (16px) to rail scale.
 *
 * Register (rev-6 Zen Instrument): geometric, mono-weight, pure ink via
 * `currentColor` so it flips with the theme through whatever text colour the
 * caller sets (e.g. `text-ink-display`). The pink node is the ONLY colour, wired
 * to `--accent` so it flips light/dark with the token. No gradients, no map pin,
 * no magnifying glass.
 */

/** The S-centerline path (24×24 grid). Round caps read as a drawn centerline. */
const MARK_PATH =
  "M18 5.5 C 18 3, 6 3, 6 8 C 6 13, 18 11, 18 16 C 18 21, 6 21, 6 18.5";

export function LogoMark({
  size = 24,
  title,
  className,
}: Readonly<{ size?: number; title?: string; className?: string }>) {
  const labelled = Boolean(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {labelled ? <title>{title}</title> : null}
      <path
        d={MARK_PATH}
        stroke="currentColor"
        strokeWidth={2.3}
        strokeLinecap="round"
      />
      {/* Audited reading node — the single flash-pink signal, theme-aware. */}
      <circle cx={18} cy={5.5} r={1.85} style={{ fill: "var(--accent)" }} />
    </svg>
  );
}

export default function Logo({
  size = 24,
  withWordmark = false,
  className,
  wordmarkClassName,
  title = "StreetLens",
}: Readonly<{
  size?: number;
  withWordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
  title?: string;
}>) {
  if (!withWordmark) {
    return <LogoMark size={size} title={title} className={className} />;
  }
  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* Mark labelled by the wordmark text beside it, so it stays decorative. */}
      <LogoMark size={size} />
      <span
        className={cn(
          "font-display font-bold leading-none tracking-[-0.03em] text-current",
          wordmarkClassName,
        )}
        style={{
          fontSize: `${(size * 0.8).toFixed(2)}px`,
          marginLeft: `${(size * 0.32).toFixed(2)}px`,
        }}
      >
        {title}
      </span>
    </span>
  );
}
