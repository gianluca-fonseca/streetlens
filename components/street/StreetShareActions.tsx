"use client";

import { useCallback, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { absoluteStreetUrl, mapSegmentPath, streetPath } from "@/lib/street-links";

type StreetShareActionsProps = Readonly<{
  segmentId: string;
  variant?: "panel" | "page";
}>;

/**
 * Copy-link and open-street-page affordances for the map panel and street card.
 */
export default function StreetShareActions({
  segmentId,
  variant = "panel",
}: StreetShareActionsProps) {
  const t = useTranslations("street.share");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    const url = absoluteStreetUrl(locale, segmentId, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [locale, segmentId]);

  const compact = variant === "panel";

  return (
    <div className={compact ? "flex shrink-0 items-center gap-1" : "flex flex-wrap items-center gap-2"}>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[4px] border border-border px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check size={13} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Copy size={13} strokeWidth={2} aria-hidden="true" />
        )}
        {copied ? t("copied") : t("copyLink")}
      </button>
      {compact ? (
        <Link
          href={streetPath(segmentId)}
          className="inline-flex min-h-[32px] items-center gap-1 rounded-[4px] border border-border px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("openStreetPage")}
        >
          <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">{t("openStreetPage")}</span>
        </Link>
      ) : (
        <Link
          href={mapSegmentPath(segmentId)}
          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-[4px] border border-border px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
          {t("openOnMap")}
        </Link>
      )}
    </div>
  );
}
