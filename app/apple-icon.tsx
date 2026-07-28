/**
 * apple-icon — the 180x180 home-screen icon iOS asks for.
 *
 * `favicon.ico` and `icon.svg` already cover browser tabs, but Safari ignores
 * an SVG icon when a site is added to the home screen and falls back to a
 * screenshot of the page, which looks like an unfinished site. This draws the
 * same mark as `public/brand/streetlens-mark-*.svg` on the brand's near-black
 * ground: iOS composites the icon on a home screen we do not control, so it has
 * to carry its own background rather than rely on `prefers-color-scheme` the
 * way `icon.svg` does.
 */
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <svg width="132" height="132" viewBox="0 0 24 24" fill="none">
          <path
            d="M18 5.5 C 18 3, 6 3, 6 8 C 6 13, 18 11, 18 16 C 18 21, 6 21, 6 18.5"
            stroke="#f2f2f2"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <circle cx="18" cy="5.5" r="1.85" fill="#ff4fa3" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
