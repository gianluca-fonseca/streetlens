# u12-mobile — mobile audit & fix plan

Audited on real mobile viewports (390×844 iPhone, 360×800 Android) via Playwright, prod-representative dev build, light mode. BEFORE evidence in `reports/evidence/u12/before/`. Zero horizontal overflow found on `/en`, `/en/map`, `/en/admin/login` at both widths.

Note: the dark circular "N" pinned bottom-left in every map/landing shot is the **Next.js dev-mode indicator**, not app chrome (prod-invisible). Findings that were only "N overlaps content" are discounted.

## Findings → fixes

| # | Surface | Problem (evidence) | Fix |
|---|---------|--------------------|-----|
| 1 | Map | `SegmentDetail` renders in a `justify-between` top row and is pushed **off the right edge** — only clipped left edges visible; its close button is off-screen so it cannot be dismissed (14-map-segmentdetail-390) | Bottom sheet on `<768px`: fixed to bottom, full-width, own scroll, drag/tap-to-dismiss, map visible above. Desktop popover unchanged. |
| 2 | Map | `MapPanel` (~330px, ~600px tall) **covers the entire viewport**; map barely visible (13-map-initial-390) | Compact-by-default on phone: collapse to a slim header chip + expand toggle; legend collapsed. Desktop unchanged. |
| 3 | Map | `Legend` always expanded inside the giant panel | Collapsible via chip toggle on phone; expanded on desktop. |
| 4 | Map | `DemoBanner` wraps to 3 lines (~70px) on phone, eating map height | Tighten to 2 lines max: smaller text/padding + `text-balance` on phone. |
| 5 | Map | Bottom cluster (3D toggle / contribute / attribution) crowds; no safe-area inset | Consolidate + add `env(safe-area-inset-bottom)`. |
| 6 | Shell | Full height via `h-full` (=100%) tracks the large viewport → bottom hides under mobile URL bar | `h-dvh-safe` utility (`100vh` fallback → `100dvh`); `viewport-fit=cover`. |
| 7 | Landing | Hero + CTA-section CTAs **not full-width** (~55%, left-aligned), under 48px (01, 11) | Full-width stacked on phone (`flex-col`, `w-full`), `min-h-[48px]`; row on `sm+`. |
| 8 | Landing | Hero attribution / section content touch the bottom edge — no gutter | Bottom safe-area padding on hero panel column. |
| 9 | Landing | Footer locale switch tap targets tiny/close (12); single sparse column | Enlarge locale tap targets to ≥44px; keep clean stack. |
| 10 | Landing | Nested map cards (measure/pilot) waste width; dark section body low contrast | Verify + tighten only if breakpoint-safe (no desktop regression). |

## Commit plan
1. viewport/safe-area foundations (globals.css + layout viewport)
2. landing mobile pass (hero, cta, footer)
3. map chrome mobile layout (MapPanel compact, banner)
4. SegmentDetail bottom sheet
5. legend/panel collapse
6. contribute touch pass + safe-area
7. evidence (after shots)

## Boundaries honored
No ramps/lib/routing-core/migrations touched. Desktop (`md:`/`sm:` gated) rev-4 design sealed. New labels via `messages/{en,es}.json` with parity.
