#!/usr/bin/env node
/**
 * test-map-aside-ux.mjs (bgsd-0016)
 *
 * Locks outside-tap segment-detail dismissal and the unified collapsible MapPanel:
 * sessionStorage visit memory, provenance visibility when collapsed, dialog aria,
 * and EN/ES collapse labels.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

console.log("outside-tap dismissal (AuditMap + SegmentDetail)");
const audit = read("components/AuditMap.tsx");
const detail = read("components/SegmentDetail.tsx");
check("AuditMap listens for outside pointerdown while a segment is open",
  audit.includes('addEventListener("pointerdown", onPointerDown') &&
  audit.includes("queryRenderedFeatures") &&
  audit.includes("handleClose()"));
// The layer set here has to be the SAME one the click handler selects from, or
// a tap lands on a segment the outside-tap handler does not recognise and the
// panel closes a heartbeat before the click reopens it. Since bgsd-0018 that set
// is APP_SELECT_LAYER_IDS, which adds the extruded relief volume to the flat
// pair: on /map the volume is the street's visible body, so a tap on it must
// count as a tap on a segment.
// The set is spread rather than named literally since the schools overlay
// joined it: a tap on a school pin is a tap on a mark, not on the page, so it
// must not close the open card either. Asserted on the two things that matter —
// the app's select set is in there, and it is filtered to layers that exist.
check("AuditMap skips close when the hit is on an interactive segment layer",
  /layers: \[\.\.\.APP_SELECT_LAYER_IDS,[^\]]*\]\.filter\(\(id\) =>\s*map\.getLayer\(id\),?\s*\)/s.test(audit) &&
  audit.includes("if (features.length > 0) return"));
check("that layer set covers the extruded relief, not just the flat lines",
  /const APP_SELECT_LAYER_IDS = \[[^\]]*RELIEF_LAYER_ID[^\]]*\]/s.test(audit) &&
  /const APP_SELECT_LAYER_IDS = \[[^\]]*LINE_LAYER_ID[^\]]*\]/s.test(audit));
check("SegmentDetail is marked for hit-testing exclusion",
  detail.includes('data-segment-detail'));
check("SegmentDetail keeps role=dialog and adds aria-modal",
  detail.includes('role="dialog"') && detail.includes('aria-modal="true"'));
check("SegmentDetail closes on Escape",
  detail.includes('e.key === "Escape"') && detail.includes("onClose()"));

console.log("");
console.log("collapsible MapPanel (desktop + mobile, visit memory)");
const panel = read("components/MapPanel.tsx");
const storage = read("lib/map-panel-storage.ts");
const panelCss = read("components/ui/map-panel.module.css");
check("MapPanel reads/writes sessionStorage via shared helper",
  panel.includes("readMapPanelCollapsed") &&
  panel.includes("writeMapPanelCollapsed") &&
  storage.includes("sessionStorage"));
check("collapse affordance is not desktop-hidden",
  panel.includes("aria-expanded={expanded}") &&
  !panel.includes("md:hidden"));
check("ProvenanceNote stays outside collapsible sections",
  panel.includes("Outside the collapsible block on purpose") &&
  panel.includes("<ProvenanceNote") &&
  !panel.includes("className={panelStyles.collapsibleInner}>\n      <ProvenanceNote"));
check("LayerSwitcher stays visible when collapsed",
  panel.includes("<LayerSwitcher") &&
  !panel.includes("className={panelStyles.collapsibleInner}>\n      <LayerSwitcher"));
check("collapse animation is ≤300ms with reduced-motion guard",
  panelCss.includes("280ms") && panelCss.includes("prefers-reduced-motion"));

console.log("");
console.log("i18n parity for panel collapse labels");
for (const loc of ["en", "es"]) {
  const messages = JSON.parse(read(`messages/${loc}.json`)).panel;
  check(`${loc}: panel.expand exists`, typeof messages.expand === "string");
  check(`${loc}: panel.collapse exists`, typeof messages.collapse === "string");
}

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — map aside UX contracts hold");
