"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { Action, Eyebrow, Notice, Plate, Screen } from "@/components/capture/ui";
import type { SegmentBrief } from "@/lib/capture/segment-brief";
import { municipalityName } from "@/lib/municipality";
import type { Locale } from "@/i18n/routing";

export function QrExplainerScreen({
  brief,
  locale,
  loading,
  error,
  onContinue,
}: Readonly<{
  brief: SegmentBrief | null;
  locale: Locale;
  loading: boolean;
  error: boolean;
  onContinue: () => void;
}>) {
  const t = useTranslations("collect.qr");

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("title", { municipality: municipalityName(locale) })}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">{t("lead")}</p>
      </header>

      {loading ? (
        <p className="text-[14px] text-ink-muted">{t("loadingSpot")}</p>
      ) : null}

      {error ? <Notice tone="warn">{t("spotUnknown")}</Notice> : null}

      {brief ? (
        <Plate className="flex flex-col gap-2 p-4">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <div>
              <p className="text-[15px] font-semibold text-ink">{brief.name}</p>
              <p className="mt-0.5 text-[12px] text-neutral-strong">{brief.district}</p>
              <p className="mt-1 font-mono text-[11px] text-ink-muted">{brief.id}</p>
            </div>
          </div>
        </Plate>
      ) : null}

      <Plate className="p-4">
        <Eyebrow>{t("howEyebrow")}</Eyebrow>
        <ol className="mt-3 flex list-none flex-col gap-2">
          {[t("how1"), t("how2"), t("how3")].map((line, i) => (
            <li key={line} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink">
              <span
                className="mt-px font-mono text-[12px] tabular-nums text-ink-faint"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ol>
      </Plate>

      <p className="text-[12px] leading-relaxed text-neutral-strong">{t("privacy")}</p>

      <Action variant="accent" onClick={onContinue} disabled={loading}>
        {t("cta")}
      </Action>
    </Screen>
  );
}
