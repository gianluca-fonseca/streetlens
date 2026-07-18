"use client";

import { useTranslations } from "next-intl";
import type { StreetStats } from "@/lib/segments";
import { cn } from "@/components/ui/cn";

/**
 * The unaudited-signal line that sits beside the audited headline figures.
 *
 * The audited figures are sealed honest: with no published audit they read 0,
 * and neither a camera pass nor a community add may ever be folded into them
 * (contract v3 ruling 1 for community, u30 for CV). But "0%" alone made the
 * real, approved work INVISIBLE — an owner who reviewed a live capture session
 * saw nothing move and read it as breakage. This renders those counters as what
 * they are: observed, not verified. It never touches `segments`, `km`,
 * `coveragePct`, or `heroPct`.
 *
 * Each line appears only when its counter is above zero, so a deployment with
 * neither signal renders nothing at all.
 */
export default function ProvenanceNote({
  stats,
  className,
  align = "start",
  tone = "page",
}: Readonly<{
  stats: StreetStats;
  className?: string;
  /** Centered on the narrow phone stacks, start-aligned in the desktop rails. */
  align?: "start" | "center";
  /** `panel` takes the glass surface's muted ink (`cn` is a joiner, not a merger). */
  tone?: "page" | "panel";
}>) {
  const t = useTranslations("provenance");

  const lines: { key: string; text: string }[] = [];
  if (stats.cvSegments > 0) {
    lines.push({
      key: "cv",
      text: t("cv", {
        segments: stats.cvSegments,
        sessions: stats.cvSessionsReviewed,
      }),
    });
  }
  if (stats.communitySegments > 0) {
    lines.push({
      key: "community",
      text: t("community", { count: stats.communitySegments }),
    });
  }
  if (lines.length === 0) return null;

  return (
    <ul
      data-testid="provenance-note"
      className={cn(
        "flex flex-col gap-1 font-mono text-[11px] leading-snug",
        tone === "panel" ? "text-neutral-strong" : "text-ink-muted",
        align === "center" ? "text-center lg:text-left" : "text-left",
        className,
      )}
    >
      {lines.map((line) => (
        <li key={line.key} data-provenance={line.key}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
