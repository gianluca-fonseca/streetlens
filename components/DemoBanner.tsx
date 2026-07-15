import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";

/**
 * Persistent, non-dismissable honesty strip: every number on the map is demo
 * data until field collection begins. Slim, keyed to the road-marking-yellow
 * accent (a caution signal), never a marketing banner.
 */
export default function DemoBanner() {
  const t = useTranslations("demoBanner");

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-surface-sunken px-4 py-1.5 text-center text-[12.5px] font-medium text-ink"
    >
      <FlaskConical
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-accent-text"
        aria-hidden="true"
      />
      <span>{t("message")}</span>
    </div>
  );
}
