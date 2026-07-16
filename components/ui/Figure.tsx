import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * A documented plate. The one figure treatment on the manifesto: a hairline
 * frame with a paper mat, the live map or a rendered plate inside (tiles never
 * touch the frame), and a journal-style caption below — mono `FIGURE N.`, a
 * bold-black claim, a serif support line, then a hairline source line with a
 * real `n=` and retrieval date. Optional mono affordance line and a pink LIVE
 * dot with a timestamp turn interactivity into documentation, not chrome.
 *
 * The caption sits in a centered text measure and stays left-aligned (captions
 * are annotations) even under a wider plate. Corners are square-ish (≤4px);
 * there is no shadow — flat framed reads as paper, a drop shadow reads as SaaS.
 */
export default function Figure({
  label,
  claim,
  support,
  source,
  affordance,
  live,
  cornerTab,
  aspectClassName = "aspect-[4/5] sm:aspect-[3/2] lg:aspect-[16/10]",
  plateClassName,
  className,
  id,
  children,
}: Readonly<{
  /** Bare label, e.g. "Figure 1" or "Figure 2a" — rendered uppercase with a period. */
  label: string;
  claim?: ReactNode;
  support?: ReactNode;
  source?: ReactNode;
  affordance?: ReactNode;
  live?: { label: ReactNode };
  /** Optional journal plate-stamp, pinned to the plate's top-left corner. */
  cornerTab?: ReactNode;
  aspectClassName?: string;
  plateClassName?: string;
  className?: string;
  id?: string;
  children: ReactNode;
}>) {
  return (
    <figure id={id} className={cn("w-full", className)}>
      <div className="rounded-[4px] border border-hairline bg-paper p-2 sm:p-3">
        <div
          className={cn(
            "relative overflow-hidden rounded-[2px] bg-paper-sunken",
            aspectClassName,
            plateClassName,
          )}
        >
          {children}
          {cornerTab ? (
            <span className="pointer-events-none absolute left-0 top-0 z-10 inline-flex items-center rounded-br-[2px] border-b border-r border-hairline bg-paper px-2.5 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
              {cornerTab}
            </span>
          ) : null}
        </div>
      </div>

      <figcaption className="mx-auto mt-5 max-w-[42.5rem] px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] text-left">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
            {label}.
          </span>
          {live ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
              />
              {live.label}
            </span>
          ) : null}
        </div>
        {claim ? (
          <p className="mt-2 font-display text-[1.18rem] font-bold leading-[1.2] tracking-[-0.01em] text-ink-display">
            {claim}
          </p>
        ) : null}
        {support ? (
          <p className="mt-1.5 font-serif text-[1rem] leading-[1.5] text-ink-muted">
            {support}
          </p>
        ) : null}
        {source || affordance ? (
          <div className="mt-3 space-y-1 border-t border-hairline pt-2.5">
            {source ? (
              <p className="font-mono text-[11.5px] leading-snug text-ink-muted">
                {source}
              </p>
            ) : null}
            {affordance ? (
              <p className="font-mono text-[11px] leading-snug text-ink-faint">
                {affordance}
              </p>
            ) : null}
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}
