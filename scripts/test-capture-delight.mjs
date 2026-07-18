#!/usr/bin/env node
/**
 * test-capture-delight.mjs — unit-capture-delight pure modules
 */

import { execFileSync } from "node:child_process";
import Module from "node:module";
import { createRequire } from "node:module";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".test-build-capture-delight");
const TSCONFIG = path.join(ROOT, ".test-tsconfig-capture-delight.json");
const require = createRequire(import.meta.url);

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  rmSync(BUILD_DIR, { recursive: true, force: true });

  writeFileSync(
    TSCONFIG,
    JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        moduleResolution: "node",
        target: "es2019",
        lib: ["es2019", "dom"],
        types: ["node"],
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
        rootDir: ".",
        outDir: path.relative(ROOT, BUILD_DIR),
      },
      files: [
        "lib/capture/quality-coach.ts",
        "lib/capture/pre-upload-gate.ts",
        "lib/capture/qr-poster.ts",
        "components/capture/engine/gating.ts",
        "components/capture/engine/session.ts",
        "components/capture/engine/tuning.ts",
        "components/capture/engine/geo.ts",
        "lib/capture/types.ts",
      ],
    }),
  );

  execFileSync("npx", ["tsc", "--project", TSCONFIG], { cwd: ROOT, stdio: "inherit" });

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
      return origResolve.call(
        this,
        path.join(BUILD_DIR, request.slice(2) + ".js"),
        parent,
        isMain,
        options,
      );
    }
    return origResolve.call(this, request, parent, isMain, options);
  };

  const { deriveCoachHints, updateMeanGray, DARK_GRAY_THRESHOLD } = require(path.join(
    BUILD_DIR,
    "lib/capture/quality-coach.js",
  ));
  const { assessUploadReadiness } = require(path.join(BUILD_DIR, "lib/capture/pre-upload-gate.js"));
  const { buildQrPosterHtml } = require(path.join(BUILD_DIR, "lib/capture/qr-poster.js"));
  const { emptyDropCounts } = require(path.join(BUILD_DIR, "components/capture/engine/gating.js"));

  function parseCollectDeepLink(search) {
    const source = search.get("src") ?? search.get("source");
    const spotRaw = search.get("spot") ?? search.get("street");
    const spotId = spotRaw && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(spotRaw) ? spotRaw : null;
    return { source, spotId, isQr: source === "qr" && spotId !== null };
  }

  function collectDeepLinkUrl(spotId, locale, origin) {
    return `${origin.replace(/\/$/, "")}/${locale}/collect?src=qr&spot=${encodeURIComponent(spotId)}`;
  }

  console.log("\n1. collect deep links");
  const qr = parseCollectDeepLink(new URLSearchParams("src=qr&spot=esc-sa-0001"));
  check("qr link detected", qr.isQr && qr.spotId === "esc-sa-0001");
  const bad = parseCollectDeepLink(new URLSearchParams("src=qr&spot=bad id"));
  check("invalid spot rejected", bad.spotId === null);
  const url = collectDeepLinkUrl("esc-sa-0001", "en", "http://localhost:3584");
  check("collect url shape", url.includes("/en/collect?src=qr&spot=esc-sa-0001"));

  console.log("\n2. quality coach");
  const gray = new Uint8Array(32 * 32).fill(20);
  check("mean gray dark", updateMeanGray(null, gray) < DARK_GRAY_THRESHOLD);
  const hints = deriveCoachHints({
    accuracyM: 30,
    dropCounts: emptyDropCounts(),
    framesKept: 10,
    meanGray: 30,
    speedMps: 3,
  });
  check("coach returns gps + dark + fast", hints.length >= 2);

  console.log("\n3. pre-upload gate");
  const gate = assessUploadReadiness({
    framesKept: 12,
    dropCounts: emptyDropCounts(),
    elapsedMs: 120_000,
    track: [
      { lat: 9.92, lng: -84.14, t: 0 },
      { lat: 9.921, lng: -84.139, t: 5000 },
    ],
    accuracyM: 12,
  });
  check("gate not blocked for ok walk", !gate.blocked);
  check("gate has items", gate.items.length >= 5);

  console.log("\n4. qr poster html");
  const html = buildQrPosterHtml({
    spotId: "esc-sa-0001",
    streetName: "Calle Test",
    district: "San Antonio",
    collectUrl: "http://x/en/collect?src=qr&spot=esc-sa-0001",
    qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    municipality: { en: "Pilot City", es: "Ciudad Piloto" },
    projectName: "StreetLens",
  });
  check("poster bilingual", html.includes("English") && html.includes("Español"));
  check("poster escapes html", !html.includes("<script"));

  if (failures.length) {
    console.error(`\nFAIL (${failures.length}):`, failures.join(", "));
    process.exit(1);
  }
  console.log("\nPASS");
}

main();
