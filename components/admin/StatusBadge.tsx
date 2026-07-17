import type { SubmissionStatus } from "@/lib/types";

/**
 * Semantic status pill driven by rev-5 status tokens: pending --amber, rejected
 * --clay, approved neutral ink (rev-5 retires green; the resolved/good state
 * reads as plain ink, not a status color). Tints use color-mix so they flip with
 * the token in dark mode. The dot is always paired with a text label — never an
 * orphan status dot (ban list).
 */

const STYLES: Record<
  SubmissionStatus,
  { dot: string; text: string; bg: string; border: string }
> = {
  pending: {
    dot: "var(--amber)",
    text: "var(--amber)",
    bg: "color-mix(in srgb, var(--amber) 15%, transparent)",
    border: "color-mix(in srgb, var(--amber) 45%, transparent)",
  },
  approved: {
    dot: "var(--ink-muted)",
    text: "var(--ink)",
    bg: "color-mix(in srgb, var(--ink) 7%, transparent)",
    border: "var(--hairline-strong)",
  },
  rejected: {
    dot: "var(--clay)",
    text: "var(--clay)",
    bg: "color-mix(in srgb, var(--clay) 14%, transparent)",
    border: "color-mix(in srgb, var(--clay) 45%, transparent)",
  },
};

export default function StatusBadge({
  status,
  label,
}: Readonly<{
  status: SubmissionStatus;
  label: string;
}>) {
  const s = STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] font-mono font-medium uppercase tracking-[0.14em]"
      style={{ backgroundColor: s.bg, borderColor: s.border, color: s.text }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
      {label}
    </span>
  );
}
