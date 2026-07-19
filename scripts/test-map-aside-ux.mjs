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
check("AuditMap skips close when the hit is on an interactive segment layer",
  audit.includes("layers: INTERACTIVE_LAYER_IDS") &&
  audit.includes("if (features.length > 0) return"));
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
