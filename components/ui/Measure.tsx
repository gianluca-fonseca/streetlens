import type { ElementType, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The centered measure. Every block on the manifesto sits in one of four bands,
 * all centered on the page axis (Distill/Tufte discipline):
 *
 *   text   ~68ch / 680px — all prose, headlines, theses (the one reading measure)
 *   outset ~840px        — wide callouts, lead abstracts
 *   page   ~1080px       — wide figures and tables
 *   screen full-bleed    — the map figure and the closing band
 *
 * Horizontal padding is safe-area aware so nothing clips into the notch/home-bar
 * gutters on phones. `screen` drops the reading padding and lets the caller own
 * its edges (figures go edge-to-edge on mobile, u12 law).
 */
export type MeasureWidth = "text" | "outset" | "page" | "screen";

const WIDTHS: Record<MeasureWidth, string> = {
  text: "max-w-[42.5rem]", // 680px
  outset: "max-w-[52.5rem]", // 840px
  page: "max-w-[67.5rem]", // 1080px
  screen: "max-w-none",
};

const PAD: Record<MeasureWidth, string> = {
  text: "px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]",
  outset:
    "px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]",
  page: "px-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]",
  screen: "px-0",
};

export default function Measure({
  children,
  width = "text",
  className,
  as: Tag = "div",
}: Readonly<{
  children: ReactNode;
  width?: MeasureWidth;
  className?: string;
  as?: ElementType;
}>) {
  return (
    <Tag className={cn("mx-auto w-full", WIDTHS[width], PAD[width], className)}>
      {children}
    </Tag>
  );
}
