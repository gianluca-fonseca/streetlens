/**
 * Self-contained SVG preview of a segment's LineString geometry. No tiles, no
 * MapLibre instance — light, deterministic, and evidence-friendly. The line is
 * pine-keyed with terracotta endpoints; the aspect ratio of the geometry is
 * preserved (square projection window).
 */

const W = 132;
const H = 76;
const PAD = 9;

export default function GeometryPreview({
  coordinates,
  ariaLabel,
  className,
}: Readonly<{
  coordinates: [number, number][];
  ariaLabel: string;
  className?: string;
}>) {
  if (!coordinates || coordinates.length < 1) return null;

  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  const minX = Math.min(...lngs);
  const maxX = Math.max(...lngs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Square projection window so lng/lat aren't distorted.
  const span = Math.max(maxX - minX, maxY - minY) || 1e-5;

  const project = ([lng, lat]: [number, number]): [number, number] => {
    const x = PAD + ((lng - (cx - span / 2)) / span) * (W - 2 * PAD);
    // Flip Y: latitude increases upward.
    const y = PAD + (1 - (lat - (cy - span / 2)) / span) * (H - 2 * PAD);
    return [x, y];
  };

  const pts = coordinates.map(project);
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const start = pts[0];
  const end = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={6}
        fill="var(--surface-sunken)"
        stroke="var(--border)"
      />
      <path
        d={d}
        fill="none"
        stroke="var(--pine)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={start[0]} cy={start[1]} r={2.6} fill="var(--terracotta)" />
      <circle cx={end[0]} cy={end[1]} r={2.6} fill="var(--terracotta)" />
    </svg>
  );
}
