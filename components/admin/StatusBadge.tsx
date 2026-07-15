import type { SubmissionStatus } from "@/lib/types";

/**
 * Semantic status pill (pending amber / approved pine / rejected clay). The dot
 * is always paired with a text label — never an orphan status dot (ban list).
 */

const STYLES: Record<
  SubmissionStatus,
  { dot: string; text: string; bg: string; border: string }
> = {
  pending: {
    dot: "#B98A16",
    text: "#7A5A0E",
    bg: "rgba(232, 184, 75, 0.16)",
    border: "rgba(185, 138, 22, 0.45)",
  },
  approved: {
    dot: "var(--pine)",
    text: "var(--pine-strong)",
    bg: "rgba(31, 92, 74, 0.12)",
    border: "rgba(31, 92, 74, 0.4)",
  },
  rejected: {
    dot: "#C0472B",
    text: "#9A3A23",
    bg: "rgba(192, 71, 43, 0.12)",
    border: "rgba(192, 71, 43, 0.42)",
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
