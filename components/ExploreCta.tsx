"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import zen from "@/components/ui/zen.module.css";
import styles from "@/components/ui/explore-cta.module.css";

/**
 * The one invitation out of the map. Visitors land on `/map` and stay there, so
 * the bottom of the aside carries a single link row into `/insights`, which is
 * the highest-value secondary route AND the hub that carries onward chrome to
 * Method, Rubric, and back to the map. One interaction reaches it.
 *
 * It reads as an invitation rather than a nag: same hairline + sunken register
 * as the layer switcher directly above it, no new accent colour (the arrow
 * carries the sanctioned pink signal), and the motion is one small arrow step
 * every few seconds. Disabled outright under prefers-reduced-motion.
 *
 * Deliberately lives OUTSIDE the panel's collapsible blocks: collapsing the
 * aside is how a visitor asks for more map, and the whole point of this row is
 * that someone who never expands the panel still finds the rest of the site.
 * It is a single row, so it costs the collapsed panel almost nothing.
 */
export default function ExploreCta({
  className,
}: Readonly<{ className?: string }>) {
  const t = useTranslations("panel");

  return (
    <Link
      href="/insights"
      data-explore-cta
      className={[
        styles.link,
        zen.control,
        "flex min-h-[44px] items-center gap-2.5 rounded-[8px] border border-border bg-surface-sunken px-2.5 py-2 text-left",
        "hover:border-border-strong hover:bg-surface-elevated",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight text-ink">
          {t("exploreTitle")}
        </span>
        <span className="mt-0.5 block text-[11px] leading-tight text-neutral-strong">
          {t("exploreSub")}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`${styles.arrowTrack} shrink-0 text-accent`}
      >
        <ArrowRight size={16} strokeWidth={2} className={styles.arrow} />
      </span>
    </Link>
  );
}
