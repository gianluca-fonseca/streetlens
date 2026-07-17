"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The margin apparatus. A mono superscript marker sits in the reading line; the
 * note floats into the right gutter on wide screens (>=1180px) and collapses to
 * an inline tap-reveal on phones (u12 law). The pink marker is a signal tick,
 * the one sanctioned pink in prose. Styling lives in globals.css (`.sl-sidenote`).
 */
export default function Sidenote({
  number,
  children,
}: Readonly<{
  number: number | string;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="sl-sidenote-marker"
      >
        <sup>{number}</sup>
        <span className="sr-only"> (note {number})</span>
      </button>
      <span id={id} role="note" className={cn("sl-sidenote", open && "is-open")}>
        <sup aria-hidden="true" className="sl-sidenote-num">
          {number}
        </sup>
        {children}
      </span>
    </>
  );
}
