import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The numbered section opener, centered on the page axis. The manifesto spine:
 * a mono section index and eyebrow kicker (`01 | WHAT WE MEASURE`), then the
 * bold-black thesis H2 (Space Grotesk 700, size + negative tracking carry the
 * weight, never a serif), then an optional upright-serif lead. A thin hairline
 * tick divides the index from the eyebrow — the apparatus, not decoration.
 */
export default function SectionHeader({
  index,
  eyebrow,
  title,
  lead,
  className,
}: Readonly<{
  index: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}>) {
  return (
    <header className={cn("text-center", className)}>
      <div className="flex items-center justify-center gap-3 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-ink-muted">
        <span className="tabular-nums">{index}</span>
        <span className="h-3 w-px bg-hairline-strong" aria-hidden="true" />
        <span>{eyebrow}</span>
      </div>
      <h2 className="mx-auto mt-5 max-w-[20ch] font-display text-[clamp(2rem,4vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-display text-balance">
        {title}
      </h2>
      {lead ? (
        <p className="mx-auto mt-5 max-w-[46rem] font-serif text-[1.18rem] leading-[1.55] text-ink text-pretty">
          {lead}
        </p>
      ) : null}
    </header>
  );
}
