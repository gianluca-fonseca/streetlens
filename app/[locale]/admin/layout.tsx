/**
 * Admin surface wrapper. The root locale layout keeps `<body>` at
 * `overflow-hidden` (the full-bleed map depends on it), so the admin section
 * owns its own scroll container. The header lives in each page (so the login
 * page can opt out of it), not here.
 */

import type { Metadata } from "next";

/**
 * The admin surface is password-gated and has no public value. Declaring
 * noindex on the segment keeps it out of the index even if a URL leaks, which
 * robots.txt alone does not guarantee.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="h-full overflow-y-auto bg-surface-base">{children}</div>
  );
}
