/**
 * Lightweight SVG bar chart — no charting library.
 */

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** 0–1 share for relative height. */
  share: number;
  color?: string;
};

export default function SvgBarChart({
  data,
  ariaLabel,
  height = 120,
}: Readonly<{
  data: BarDatum[];
  ariaLabel: string;
  height?: number;
}>) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 8;
  const barW = data.length > 0 ? (100 - gap * (data.length - 1)) / data.length : 100;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 100 ${height}`}
      className="h-auto w-full"
      preserveAspectRatio="none"
    >
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 28);
        const x = i * (barW + gap);
        const y = height - 20 - h;
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.value > 0 ? 1.5 : 0)}
              fill={d.color ?? "currentColor"}
              className="text-ink-display"
              rx={0.8}
            />
            <text
              x={x + barW / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-ink-muted"
              style={{ fontSize: 5, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {d.label}
            </text>
            {d.value > 0 ? (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                className="fill-ink"
                style={{ fontSize: 5, fontFamily: "var(--font-plex-mono), monospace" }}
              >
                {d.value}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
