/**
 * Admin surface wrapper. The root locale layout keeps `<body>` at
 * `overflow-hidden` (the full-bleed map depends on it), so the admin section
 * owns its own scroll container. The header lives in each page (so the login
 * page can opt out of it), not here.
 */
export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="h-full overflow-y-auto bg-surface-base">{children}</div>
  );
}
