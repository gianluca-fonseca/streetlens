"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Subtle reveal-on-scroll: fade + short rise, fired once when the element
 * enters the viewport. Honors prefers-reduced-motion (renders visible, no
 * transition) and degrades to visible if IntersectionObserver is unavailable.
 * This is the whole motion budget for content — the map camera is the other.
 */
export default function Reveal({
  children,
  className,
  as: Tag = "div",
  delay = 0,
}: Readonly<{
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section";
  delay?: number;
}>) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // @ts-expect-error polymorphic ref across the small Tag union
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
