"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function QrPosterPanel({
  locale,
  defaultOrigin,
}: Readonly<{ locale: string; defaultOrigin: string }>) {
  const t = useTranslations("admin.qrPosters");
  const [spotId, setSpotId] = useState("esc-sa-0001");
  const [origin, setOrigin] = useState(defaultOrigin);

  const openPoster = () => {
    const params = new URLSearchParams({
      spot: spotId.trim(),
      locale,
      origin: origin.trim(),
    });
    window.open(`/api/admin/qr-poster?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex max-w-lg flex-col gap-4 rounded-[8px] border border-border bg-surface-elevated p-4">
      <div>
        <label htmlFor="qr-spot" className="mb-1 block text-[12px] font-medium text-ink">
          {t("spotLabel")}
        </label>
        <input
          id="qr-spot"
          value={spotId}
          onChange={(e) => setSpotId(e.target.value)}
          className="w-full rounded-[4px] border border-border bg-surface-base px-2.5 py-2 font-mono text-[13px] text-ink"
        />
        <p className="mt-1 text-[12px] text-neutral-strong">{t("spotHint")}</p>
      </div>
      <div>
        <label htmlFor="qr-origin" className="mb-1 block text-[12px] font-medium text-ink">
          {t("originLabel")}
        </label>
        <input
          id="qr-origin"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          className="w-full rounded-[4px] border border-border bg-surface-base px-2.5 py-2 font-mono text-[13px] text-ink"
        />
      </div>
      <button
        type="button"
        onClick={openPoster}
        className="inline-flex items-center justify-center rounded-[6px] border border-ink-display bg-ink-display px-4 py-2.5 text-[14px] font-medium text-surface hover:opacity-90"
      >
        {t("generate")}
      </button>
      <p className="text-[12px] leading-relaxed text-neutral-strong">{t("scriptHint")}</p>
    </div>
  );
}
