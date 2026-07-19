"use client";

/**
 * Triggers the browser print dialog — the mandated "Download PDF" path
 * (no server-side PDF renderer; print stylesheet does the rest).
 */

export default function PrintButton({
  label,
}: Readonly<{ label: string }>) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="civic-no-print inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-border bg-ink px-4 py-2 text-[13px] font-medium text-surface transition-colors hover:bg-ink-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {label}
    </button>
  );
}
