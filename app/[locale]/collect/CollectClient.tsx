"use client";

/**
 * The client boundary for the two capture paths, and the chooser in front of
 * them.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { FileVideo, Video } from "lucide-react";
import { Eyebrow, Screen } from "@/components/capture/ui";
import { QrExplainerScreen } from "@/components/capture/QrExplainerScreen";
import { MyWalksShelf } from "@/components/capture/MyWalksShelf";
import { openCaptureStore } from "@/components/capture/engine/opfs";
import { isRecoverable } from "@/components/capture/engine/session";
import { looksLikeVideoSession } from "@/components/capture/engine/video-session";
import {
  hasSeenQrWelcome,
  markQrWelcomeSeen,
  type CollectDeepLink,
} from "@/lib/capture/collect-deep-link";
import type { SegmentBrief } from "@/lib/capture/segment-brief";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/components/ui/cn";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import styles from "@/components/ui/zen.module.css";

const LiveRecorder = dynamic(() => import("@/components/capture/LiveRecorder"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
});

const VideoUploader = dynamic(() => import("@/components/capture/VideoUploader"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
});

type Mode = "live" | "upload";

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
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>{t("chooser.eyebrow")}</Eyebrow>
          <ThemeSwitcher className="shrink-0 text-ink-muted" />
        </div>
        <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-display">
          {t("chooser.title")}
        </h1>
        <p className="font-serif text-[17px] leading-[1.6] text-neutral-strong">
          {t("chooser.lead")}
        </p>
      </header>

      <MyWalksShelf />

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

export default function CollectClient({
  locale,
  deepLink,
}: Readonly<{ locale: Locale; deepLink: CollectDeepLink }>) {
  const seenQrBefore = deepLink.isQr && hasSeenQrWelcome();
  const [mode, setMode] = useState<Mode | null>(seenQrBefore ? "live" : null);
  const [unfinishedWalk, setUnfinishedWalk] = useState<boolean | null>(null);
  const [showQrWelcome, setShowQrWelcome] = useState(deepLink.isQr && !seenQrBefore);
  const [spotBrief, setSpotBrief] = useState<SegmentBrief | null>(null);
  const [spotLoading, setSpotLoading] = useState(Boolean(deepLink.isQr && deepLink.spotId));
  const [spotError, setSpotError] = useState(false);
  const qrReady = !deepLink.isQr || seenQrBefore || !showQrWelcome;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = await openCaptureStore();
        const manifests = await store.listManifests();
        if (cancelled) return;
        setUnfinishedWalk(
          manifests.some((m) => !looksLikeVideoSession(m) && isRecoverable(m)),
        );
      } catch {
        if (!cancelled) setUnfinishedWalk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!deepLink.isQr || !deepLink.spotId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/segments/${encodeURIComponent(deepLink.spotId!)}/brief`);
        if (cancelled) return;
        if (!res.ok) {
          setSpotError(true);
          setSpotBrief(null);
        } else {
          setSpotBrief((await res.json()) as SegmentBrief);
        }
      } catch {
        if (!cancelled) setSpotError(true);
      } finally {
        if (!cancelled) setSpotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLink.isQr, deepLink.spotId]);

  const continueFromQr = () => {
    markQrWelcomeSeen();
    setShowQrWelcome(false);
    setMode("live");
  };

  if (showQrWelcome && deepLink.isQr) {
    return (
      <QrExplainerScreen
        brief={spotBrief}
        locale={locale}
        loading={spotLoading}
        error={spotError}
        onContinue={continueFromQr}
      />
    );
  }

  if (mode === "live" && qrReady) {
    return <LiveRecorder spotBrief={spotBrief} />;
  }
  if (mode === "upload") return <VideoUploader onBack={() => setMode(null)} />;

  if (unfinishedWalk === null) return <div className="min-h-0 flex-1" aria-hidden="true" />;
  if (unfinishedWalk) return <LiveRecorder spotBrief={spotBrief} />;

  return <ModeChooser onChoose={setMode} />;
}
