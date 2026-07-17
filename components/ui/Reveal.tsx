"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The single sanctioned section reveal (research §3): a subtle opacity + 8px rise,
 * fired once when the block scrolls into view. Constrained on all four failure
 * modes — small translate, no child stagger, once-only, and JS-off safe.
 *
 * The hidden pre-reveal state lives entirely in CSS under `.js-enabled` (set by an
 * inline script before paint), so the REVEALED state is the default and content is
 * always visible if JS fails or is disabled. This component only adds `is-visible`
 * when the block enters the viewport (or immediately under reduced motion / no IO).
 */
export default function Reveal({
  children,
  className,
  as: Tag = "div",
}: Readonly<{
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li";
}>) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => el.classList.add("is-visible");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      reveal();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // @ts-expect-error polymorphic ref across the small Tag union
      ref={ref}
      className={cn("sl-reveal", className)}
    >
      {children}
    </Tag>
  );
}
