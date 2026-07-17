"use client";

/**
 * The client boundary for the recorder.
 *
 * This file exists for one reason: `next/dynamic` with `ssr: false` is not
 * allowed in a Server Component in Next 16 (`node_modules/next/dist/docs/01-app/
 * 02-guides/lazy-loading.md`: "ssr: false is not allowed with next/dynamic in
 * Server Components. Please move it into a Client Component."). So the server
 * page keeps the metadata and the locale, and the ssr:false call lives here.
 *
 * The recorder genuinely cannot prerender: it reaches for getUserMedia, OPFS,
 * wake lock and requestVideoFrameCallback, none of which exist on the server, and
 * feature detection at module scope would throw during the prerender pass.
 */

import dynamic from "next/dynamic";

const LiveRecorder = dynamic(() => import("@/components/capture/LiveRecorder"), {
  ssr: false,
  // Matches the recorder's own layout so the swap does not shift the page.
  loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
});

export default function CollectClient() {
  return <LiveRecorder />;
}
