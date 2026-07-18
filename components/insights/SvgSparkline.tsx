/**
 * Lightweight SVG sparkline for cumulative coverage km over time.
 */

export type SparkPoint = { xLabel: string; y: number };

export default function SvgSparkline({
  points,
  ariaLabel,
  height = 72,
}: Readonly<{
  points: SparkPoint[];
  ariaLabel: string;
  height?: number;
}>) {
  if (points.length === 0) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-[72px] items-center justify-center border border-dashed border-hairline font-mono text-[11px] text-ink-muted"
      >
        —
      </div>
    );
  }

  const maxY = Math.max(0.001, ...points.map((p) => p.y));
  const w = 100;
  const pad = 4;
  const coords = points.map((p, i) => {
    const x =
      points.length === 1
        ? w / 2
        : pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = height - pad - (p.y / maxY) * (height - pad * 2);
    return `${x},${y}`;
  });
  const polyline = coords.join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${w} ${height}`}
      className="h-auto w-full text-ink-display"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        points={polyline}
        vectorEffect="non-scaling-stroke"
      />
      {points.length === 1 ? (
        <circle
          cx={w / 2}
          cy={height - pad - (last.y / maxY) * (height - pad * 2)}
          r={1.8}
          fill="currentColor"
        />
      ) : null}
    </svg>
  );
}
