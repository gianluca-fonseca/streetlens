import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { LEY_7600_MIN_SCORE } from "@/lib/types";
import {
  LENS_ORDER,
  PUBLIC_RUBRIC_ITEMS,
} from "@/lib/rubric-public";
import Measure from "@/components/ui/Measure";
import PublicDocChrome from "@/components/insights/PublicDocChrome";

export default async function RubricView({
  locale,
}: Readonly<{ locale: Locale }>) {
  const t = await getTranslations({ locale, namespace: "rubricPage" });
  const ti = await getTranslations({ locale, namespace: "insights" });
  const tl = await getTranslations({ locale, namespace: "layers" });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface text-ink">
      <PublicDocChrome
        homeLabel={ti("chrome.home")}
        insightsLabel={ti("chrome.insights")}
        methodLabel={ti("chrome.method")}
        rubricLabel={ti("chrome.rubric")}
        mapLabel={ti("chrome.map")}
        active="rubric"
      />

      <main className="pb-16">
        <Measure width="outset" className="pt-10 sm:pt-14">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 max-w-[24ch] font-display text-[clamp(1.6rem,3.2vw,2.15rem)] font-bold leading-[1.12] tracking-[-0.02em] text-ink-display text-balance">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[52ch] font-serif text-[1.05rem] leading-[1.6] text-ink-muted text-pretty">
            {t("lead")}
          </p>
          <p className="mt-4 rounded-[2px] border border-hairline bg-paper-white px-3 py-2 font-mono text-[11px] leading-snug text-ink-muted">
            {t("honesty")}
          </p>
        </Measure>

        <Measure width="text" className="mt-10">
          <p className="font-serif text-[1.05rem] leading-[1.7] text-ink">
            {t("threshold", { threshold: LEY_7600_MIN_SCORE })}
          </p>
        </Measure>

        {LENS_ORDER.map((layer) => {
          const items = PUBLIC_RUBRIC_ITEMS.filter((i) => i.layer === layer);
          if (items.length === 0) return null;
          return (
            <Measure key={layer} width="page" className="mt-12">
              <h2 className="font-display text-[1.2rem] font-semibold tracking-[-0.01em] text-ink-display">
                {tl(`${layer}.name`)}
              </h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                {tl(`${layer}.short`)}
              </p>
              <div className="mt-4 overflow-x-auto rounded-[4px] border border-hairline">
                <table className="w-full min-w-[28rem] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-sunken font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-muted">
                      <th className="px-3 py-2.5 text-left font-semibold">
                        {t("colItem")}
                      </th>
                      <th className="px-3 py-2.5 text-left font-semibold">
                        {t("colResponse")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.key}
                        className="border-b border-hairline last:border-b-0"
                      >
                        <td className="px-3 py-2.5 text-ink">
                          {t(`items.${item.key}` as "items.sidewalk_present")}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[12px] text-ink-muted">
                          {t(`response.${item.response}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Measure>
          );
        })}

        <Measure width="outset" className="mt-14">
          <div className="flex flex-wrap gap-4 border-t border-hairline pt-6 text-[13px]">
            <Link
              href="/method"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.method")}
            </Link>
            <Link
              href="/insights"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.insights")}
            </Link>
            <Link
              href="/map"
              className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
            >
              {t("footer.map")}
            </Link>
          </div>
        </Measure>
      </main>
    </div>
  );
}
