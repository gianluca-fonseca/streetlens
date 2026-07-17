# u27 live recorder — plan

Unit: `unit-live-recorder-a296` · run `bgsd-0002-cv-data-collection-funne` · scale feature.
Written after research; validated against the worktree. Seed is authority except where
research contradicts it (section 1).

## 1. Seed corrections (validated against code, not assumed)

| Seed said | Reality | Action |
| --- | --- | --- |
| "If upload-client storage PUT is still TODO from u25, implement it here properly (supabase-js anon upload to `streetlens-frames`)." | **False premise.** `uploadFrameBytes` (upload-client.ts:294-322) is fully implemented: `getSupabaseClient()` → `.storage.from(CAPTURE_BUCKET).upload(path, blob, {contentType:"image/jpeg", upsert:false})`, 409/`/exists/i` → `"already_present"`. The `TODO(unit-capture-ingest)` above it is a **verification** TODO (the bucket is not live yet), not an empty body. | **No work.** `lib/capture/*` is frozen; consume it. Record as assumption. |
| Uploads "stubs return 501 — assert the client surfaces the backend-not-live state gracefully" | Confirmed. All 4 routes return `notImplemented()` → 501. 501 is **not** in `RETRYABLE_STATUS`, so `uploadCapture` fails fast at `createSession`. | Recorder must render an honest "backend not live" state, frames retained in OPFS, retry offered. This is the *expected* path today. |
| Playwright with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` + context geolocation override | Playwright is **not** an installed package. Repo precedent is the bgsd Playwright **MCP server**, whose launch options are fixed (`channel: chrome`); those Chromium flags and `browserContext.setGeolocation` are **not reachable** through it. | Deviation, same intent: stub `navigator.mediaDevices.getUserMedia` (canvas `captureStream()` → a real, animated `MediaStream`) and `navigator.geolocation` (scripted Escazú walk) via `browser_evaluate` before the recorder starts. Documented in the verification report as a deviation. |

## 2. Architecture

Frozen contracts consumed, never redefined: `CaptureFrameMeta`, `TrackPoint`, `CAPTURE_LIMITS`
(`maxFrames: 400`, `maxFrameBytes: 2_097_152`), `captureFrameStoragePath`, `uploadCapture`,
`CaptureUploadError`. Note `captureFrameMetaSchema.seq` is `0..maxFrames-1` (399).

### Routes
- `app/[locale]/collect/page.tsx` — server shell. `const { locale } = await params` → `setRequestLocale(locale)`
  first, metadata from a new `collect.meta` namespace mirroring `landing.meta`. Renders the client loader.
- `app/[locale]/collect/CollectClient.tsx` — `"use client"` thin wrapper. **`next/dynamic` with `ssr:false`
  must live here, not in the server page** (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:94`:
  "`ssr: false` is not allowed with `next/dynamic` in Server Components").
- `app/[locale]/collect/status/[id]/page.tsx` — minimal honest placeholder ("processing starts shortly").
  No `generateStaticParams` → dynamic at request time, which is correct for a runtime id.

### `components/capture/`
Pure logic (no React import, so `scripts/test-*.mjs` can compile + require it):
- `engine/frame-analysis.ts` — `toGray32()`, `frameDelta()` (dedupe), `laplacianVariance()` (blur).
- `engine/geo.ts` — `haversineMeters()`, `trackDistanceMeters()`.
- `engine/gating.ts` — `shouldKeepFrame()`: the both-gates rule (≥1000ms AND ≥6m) + dedupe + blur, returns
  a discriminated verdict so drop reasons are countable.
- `engine/opfs.ts` — write-through store: frame blobs + `manifest.json`, session scan/recover/discard.
- `engine/session.ts` — local session + manifest types, sub-segment handling.

Hooks (React, browser-only): `useCamera`, `useGeolocation`, `useWakeLock`, `useFrameClock` (rVFC with
rAF+timestamp fallback), `useRecorder` (the state machine).

States: `checking → unsupported | recover | idle → starting → recording ⇄ paused → review → uploading → done | error`.

### Sealed-design compliance
Space Grotesk/Newsreader/Plex Mono via `font-sans`/`font-serif`/`font-mono` utilities. Radii 2/4/6
(`rounded-chip/panel/primary`). Pink `--accent` signal-only: REC dot + primary CTA. **Glass only over live
map tiles** → `zen.module.css` `.glassPanel` allowed *only* on the review mini-map; the recording HUD sits
over a camera preview, not map tiles, so it uses solid plate + hairline. No emoji. No em dashes.
Own the scroll container as a direct flex child of body (`min-h-0 flex-1`), per `map/page.tsx`.

## 3. Commit sequence (atomic, explicit pathspecs)
1. engine pure logic + local session types
2. OPFS write-through store
3. browser hooks (camera/geo/wakelock/frameclock)
4. recorder state machine
5. UI screens (start/HUD/review/upload/done/recover/unsupported)
6. mini map
7. routes (collect page, client loader, status placeholder)
8. i18n EN + ES parity
9. contribute choose-sheet entry
10. test script + evidence + MANUAL-VERIFY.md

## 4. Verification bar
- Gates (repo precedent, verbatim): `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- `scripts/test-capture-gating.mjs` — locks the pure gating/analysis logic (node, tsc→CJS, `check()` helper,
  exit 1 on any failure), matching `scripts/test-capture-schemas.mjs`.
- Browser drive via Playwright MCP at 390px with stubbed media+geolocation: start→record→stop→review,
  assert frames kept > 0 and OPFS manifest written (`browser_evaluate`), assert 501 surfaces honestly.
- EN + ES screenshots, light + dark → `.planning/evidence/u27/`.
- `MANUAL-VERIFY.md` matching `.planning/evidence/u8/MANUAL-VERIFY.md` structure: what needs a real phone
  (iOS Safari camera, wake lock, OPFS persistence, backgrounding, blur-threshold tuning).
- `GATES.txt` matching `.planning/evidence/u25/GATES.txt`, including an honest NOT-verified section.
