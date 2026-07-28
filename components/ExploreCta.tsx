"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import zen from "@/components/ui/zen.module.css";
import styles from "@/components/ui/explore-cta.module.css";

/**
 * The one invitation out of the map. Visitors land on `/map` and stay there, so
 * the foot of the aside carries a single link into `/insights`: the highest
 * value secondary route, and itself the hub whose chrome carries on to Method
 * and Rubric. One interaction reaches it.
 *
 * Shaped as a panel FOOTER, not a button. It goes full bleed (`-mx-4`, and the
 * panel drops its own bottom padding for it), so the invitation costs the left
 * column ~44px rather than ~66px. That matters: the column also carries
 * the 3D toggle above the contribute button, and a boxed CTA pushed the toggle
 * into it at 1440x900. A hairline-topped footer strip is also the more native
 * form here (the figures row already divides with `border-y`), and it keeps the
 * invitation from reading as a generic template button.
 *
 * It is STICKY because the aside caps its own height and scrolls when the copy
 * outgrows the viewport (the Spanish panel does at 1440x900). A footer that
 * scrolls out of the panel is an invitation nobody sees. The pinned strip takes
 * the opaque elevated surface so content passing beneath it never ghosts
 * through the label. Glass is never stacked on glass.
 *
 * Deliberately OUTSIDE the panel's collapsible blocks: collapsing the aside is
 * how a visitor asks for more map, and a visitor who never expands the panel is
 * exactly the one this row needs to reach.
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
        "sticky bottom-0 z-10 -mx-4 -mt-1 flex min-h-[44px] items-center gap-2.5 rounded-b-[11px] border-t border-border px-4 py-2.5",
        "bg-surface-elevated text-[13px] font-medium leading-tight text-ink hover:bg-surface-sunken",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="min-w-0 flex-1">{t("explore")}</span>
      <span
        aria-hidden="true"
        className={`${styles.arrowTrack} shrink-0 text-accent`}
      >
        <ArrowRight size={16} strokeWidth={2} className={styles.arrow} />
      </span>
    </Link>
  );
}
