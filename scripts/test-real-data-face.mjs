#!/usr/bin/env node
/**
 * test-real-data-face.mjs — locks the real-data-era public composition,
 * honesty copy hooks, map chrome, and contribute deep-link contract.
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

console.log("real-data-era helper");
const era = read("lib/real-data-era.ts");
check("exports hideAuditedZeros", era.includes("export function hideAuditedZeros"));
check("exports listRecentlyCvObserved", era.includes("export function listRecentlyCvObserved"));
check("uses showDemoData gate", era.includes("showDemoData()"));

console.log("");
console.log("landing composition surfaces");
const hero = read("components/landing/Hero.tsx");
check("Hero imports hideAuditedZeros", hero.includes("hideAuditedZeros"));
check("Hero shows CV stats when audited hidden", hero.includes('t("stats.cvSegmentsLabel")'));
check("Hero has CV segment empty state", hero.includes('t("segments.empty")'));

const gap = read("components/landing/GapSection.tsx");
check("GapSection drops stat3 when demo off", gap.includes("showDemoData()") && gap.includes('key: "3"'));

const pilot = read("components/landing/PilotSection.tsx");
check("PilotSection hides audited zeros", pilot.includes("auditedHidden") && pilot.includes('t("auditedEmpty")'));

console.log("");
console.log("map chrome and contribute deep-link");
const mapPage = read("app/[locale]/map/page.tsx");
check("map page renders MapChrome", mapPage.includes("<MapChrome"));
check("map page passes openContributeOnMount", mapPage.includes("openContributeOnMount"));

const auditMap = read("components/AuditMap.tsx");
check("AuditMap accepts openContributeOnMount", auditMap.includes("openContributeOnMount"));
check("AuditMap opens contribute on mount", auditMap.includes("contribute.open()"));

const cta = read("components/landing/CtaSection.tsx");
check("contribute CTA deep-links", cta.includes('href="/map?contribute=1"'));

const chrome = read("components/MapChrome.tsx");
check("MapChrome links home", chrome.includes('href="/"'));
check("MapChrome has locale switch", chrome.includes("<LocaleSwitcher"));
check("MapChrome has theme switch", chrome.includes("<ThemeSwitcher"));

console.log("");
console.log("honesty copy in messages");
const en = JSON.parse(read("messages/en.json"));
const es = JSON.parse(read("messages/es.json"));

check("EN FAQ ai mentions camera proposals", en.landing.faq.items.ai.a.includes("proposals"));
check("EN method pipeline no longer claims CV is not built",
  !en.landing.method.pipeline.body.includes("No model scores a street today"));
check("EN pipeline plate source is live",
  en.landing.method.plates.pipeline.source.includes("Live today"));

check("ES hero stats keys exist", !!es.landing.hero.stats.cvSegmentsLabel);
check("ES avoids translationese vivibles in hero subtitle",
  !es.landing.hero.subtitle.includes("vivibles"));
check("ES mission uses Desde la calle", es.landing.mission.principles.together.label.includes("Desde la calle"));
check("ES open source uses ver o contribuir", es.landing.hero.openSource.includes("ver o contribuir"));

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PASS — real-data-face composition and honesty hooks are wired");
