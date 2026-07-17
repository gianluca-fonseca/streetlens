import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * A single mono numeral with an optional unit and a supporting label. Every
 * data number on the public surface is IBM Plex Mono; this is the primitive
 * that guarantees it. Presentational only — callers own the surrounding <dl>
 * semantics when a description list is appropriate.
 */
export default function StatFigure({
  value,
  unit,
  label,
  sublabel,
  tone = "ink",
  size = "md",
  className,
}: Readonly<{
  value: ReactNode;
  unit?: ReactNode;
  label: ReactNode;
  sublabel?: ReactNode;
  tone?: "ink" | "accent";
  size?: "sm" | "md" | "lg";
  className?: string;
}>) {
  const valueSize =
    size === "lg"
      ? "text-[clamp(2.2rem,5vw,3.05rem)]"
      : size === "sm"
        ? "text-[1.4rem]"
        : "text-[2.15rem]";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p
        className={cn(
          "font-mono font-medium leading-none tracking-tight",
          valueSize,
          tone === "accent" ? "text-accent-text" : "text-ink",
        )}
      >
        {value}
        {unit ? (
          <span className="ml-0.5 text-[0.5em] font-medium text-neutral-strong">
            {unit}
          </span>
        ) : null}
      </p>
      <p className="text-[0.95rem] font-medium leading-snug text-ink">{label}</p>
      {sublabel ? (
        <p className="text-[12.5px] leading-snug text-neutral-strong">
          {sublabel}
        </p>
      ) : null}
    </div>
  );
}
