import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Small all-caps pine eyebrow — the connective tissue above section headlines.
 * Never used as the only hierarchy (ban #14): it always pairs with a headline.
 */
export default function Eyebrow({
  children,
  className,
  tone = "pine",
}: Readonly<{
  children: ReactNode;
  className?: string;
  /** "pine" on bone surfaces; "muted" for the dark field section. */
  tone?: "pine" | "muted";
}>) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.14em]",
        tone === "pine" ? "text-pine" : "text-[#a9ac9f]",
        className,
      )}
    >
      {children}
    </p>
  );
}
