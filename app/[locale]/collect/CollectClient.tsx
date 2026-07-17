"use client";

/**
 * The client boundary for the two capture paths, and the chooser in front of
 * them.
 *
 * This file exists for one reason: `next/dynamic` with `ssr: false` is not
 * allowed in a Server Component in Next 16 (`node_modules/next/dist/docs/01-app/
 * 02-guides/lazy-loading.md`: "ssr: false is not allowed with next/dynamic in
 * Server Components. Please move it into a Client Component."). So the server
 * page keeps the metadata and the locale, and the ssr:false calls live here.
 *
 * Both paths genuinely cannot prerender, for overlapping reasons. The recorder
 * reaches for getUserMedia, OPFS, wake lock and requestVideoFrameCallback; the
 * uploader reaches for OPFS, WebCodecs and mp4box, and mp4box is ESM-only. None
 * of it exists on the server, and feature detection at module scope would throw
 * during the prerender pass. So neither gets an `ssr: true`, ever.
 *
 * WHY THE CHOOSER IS A GATE AND NOT A TAB STRIP. Both modules are heavy and each
 * pulls a different chunk (MapLibre and mp4box do not overlap). Rendering both
 * and hiding one would download both on a phone, on a data plan, to show one. The
 * gate means the dynamic import fires on the choice, which is what `ssr: false`
 * plus `next/dynamic` is for. The cost is that switching modes means coming back
 * here, which the uploader offers explicitly.
 *
 * The live recorder's behaviour is UNCHANGED by any of this. It mounts exactly as
 * it did, with the same props (none), the same loading placeholder, and the same
 * ssr:false. The only difference is that something is rendered before it.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { FileVideo, Video } from "lucide-react";
import { Eyebrow, Screen } from "@/components/capture/ui";
import { cn } from "@/components/ui/cn";
import styles from "@/components/ui/zen.module.css";

const LiveRecorder = dynamic(() => import("@/components/capture/LiveRecorder"), {
  ssr: false,
  // Matches the recorder's own layout so the swap does not shift the page.
  loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
});

const VideoUploader = dynamic(() => import("@/components/capture/VideoUploader"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
});

type Mode = "live" | "upload";

/**
 * One way in.
 *
 * A real `<button>` wrapping the whole card, not a card with a button in a
 * corner: the target is the card, so the control should be the card. The title,
 * the body and the icon are all inside it, which is exactly what a screen reader
 * should read when it announces the button.
 */
function ModeCard({
  icon,
  title,
  body,
  cta,
  testId,
  onClick,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  testId: string;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        styles.plateInteractive,
        "flex flex-col items-start gap-2 rounded-[6px] border border-border bg-surface-elevated p-4 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
      )}
    >
      <span className="text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      <span className="text-[15px] font-semibold text-ink-display">{title}</span>
      <span className="text-[12px] leading-relaxed text-neutral-strong">{body}</span>
      <span className="mt-1 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-ink">
        {cta}
      </span>
    </button>
  );
}

function ModeChooser({ onChoose }: Readonly<{ onChoose: (mode: Mode) => void }>) {
  const t = useTranslations("collect");

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("chooser.eyebrow")}</Eyebrow>
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("chooser.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("chooser.lead")}
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2">
        <ModeCard
          icon={<Video className="size-5" strokeWidth={1.75} />}
          title={t("chooser.liveTitle")}
          body={t("chooser.liveBody")}
          cta={t("chooser.live")}
          testId="choose-live"
          onClick={() => onChoose("live")}
        />
        <ModeCard
          icon={<FileVideo className="size-5" strokeWidth={1.75} />}
          title={t("chooser.uploadTitle")}
          body={t("chooser.uploadBody")}
          cta={t("chooser.upload")}
          testId="choose-upload"
          onClick={() => onChoose("upload")}
        />
      </div>
    </Screen>
  );
}

export default function CollectClient() {
  const [mode, setMode] = useState<Mode | null>(null);

  if (mode === "live") return <LiveRecorder />;
  if (mode === "upload") return <VideoUploader onBack={() => setMode(null)} />;
  return <ModeChooser onChoose={setMode} />;
}
