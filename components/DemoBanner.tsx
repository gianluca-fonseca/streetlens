import { useTranslations } from "next-intl";

/**
 * Persistent, non-dismissable banner flagging that all visible data is demo
 * data. Rendered on every page until real field data replaces the demo set.
 */
export default function DemoBanner() {
  const t = useTranslations("demoBanner");

  return (
    <div
      role="status"
      className="w-full bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      {t("message")}
    </div>
  );
}
