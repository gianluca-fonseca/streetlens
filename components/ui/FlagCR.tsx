/**
 * The Costa Rican civil flag, drawn rather than set as an emoji so it renders
 * identically on every platform (the emoji falls back to the letters "CR" on
 * several) and so the bands stay crisp at banner size.
 *
 * Bands run 1:1:2:1:1 from the top: blue, white, red, white, blue. The hairline
 * frame is what keeps the white bands from dissolving into a paper background.
 */
export default function FlagCR({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 18"
      className={className}
      role="img"
      aria-label="Costa Rica"
      focusable="false"
    >
      <rect width="30" height="18" fill="#002B7F" />
      <rect y="3" width="30" height="12" fill="#FFFFFF" />
      <rect y="6" width="30" height="6" fill="#CE1126" />
      <rect
        x="0.5"
        y="0.5"
        width="29"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
    </svg>
  );
}
