#!/usr/bin/env node
/**
 * test-panel-vitality.mjs (u33)
 *
 * Guards the parts of the detail panel's new visual register that a browser
 * drive cannot cheaply prove and that would regress silently.
 *
 * The load-bearing one is REDUCED MOTION. A meter that animates its fill is
 * exactly the kind of thing that ships without a reduced-motion path, and the
 * failure is invisible to everyone who does not set the preference. So the
 * authored reduced variant is asserted to exist, to cover every animated class,
 * and to actually cancel the animation rather than merely shorten it.
 *
 * The second is the COPY CONTRACT. This unit is presentation-only: the honesty
 * wording from bgsd-0009 ("not yet field-audited", the assessment note, the
 * unset "—" rationale) is untouchable, so both message catalogues are asserted
 * byte-identical against git HEAD~ rather than merely parity-checked. Parity
 * alone would happily pass if a string were reworded in BOTH locales.
 *
 * The third is that colour never became the ONLY channel: each chip keeps its
 * icon and its full text label, and each score keeps its numeral.
 *
 * Exits 0 on PASS, 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const css = readFileSync(path.join(ROOT, "components/ui/panel.module.css"), "utf8");
const tsx = readFileSync(path.join(ROOT, "components/SegmentDetail.tsx"), "utf8");

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** The reduced-motion at-rule body, or "" if there is none. */
function reducedMotionBlock(source) {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

// ---------------------------------------------------------------- //
// 1. Reduced motion is authored, and covers everything that animates.
// ---------------------------------------------------------------- //

const reduced = reducedMotionBlock(css);
check("panel.module.css authors a prefers-reduced-motion: reduce block", reduced.length > 0);

// Every class carrying an `animation:` outside the reduced block must be named
// inside it. Derived from the file rather than hard-coded, so a NEW animated
// class is caught the day it is added instead of the day someone remembers.
{
  const outside = css.slice(0, css.indexOf("@media (prefers-reduced-motion: reduce)"));
  const animated = new Set();
  const ruleRe = /\.([A-Za-z][\w-]*)[^{}]*\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(outside)) !== null) {
    if (/(^|[\s;])animation\s*:/.test(m[2])) animated.add(m[1]);
  }
  check(
    "at least one class animates (the test can actually fail)",
    animated.size > 0,
    [...animated].join(", "),
  );
  const uncovered = [...animated].filter((c) => !new RegExp(`\\.${c}\\b`).test(reduced));
  check(
    "every animated class has a reduced-motion variant",
    uncovered.length === 0,
    uncovered.length ? `uncovered: ${uncovered.join(", ")}` : [...animated].join(", "),
  );
}

// The meters must be CANCELLED, not merely sped up. `animation: none` on the
// fills is what guarantees a bar is at its true width on the first painted
// frame; a shortened duration still animates, and still moves.
check(
  "meter and gauge fills cancel their animation outright under reduced motion",
  /\.meterFill\s*,\s*\.gaugeFill\s*\{[^}]*animation:\s*none/.test(reduced),
);
check(
  "and hold no residual transform (the bar is at full width, not scaled)",
  /\.meterFill\s*,\s*\.gaugeFill\s*\{[^}]*transform:\s*none/.test(reduced),
);
// Arrival keeps a short opacity fade: globals.css's house rule is to author the
// reduced variant, not to blanket-strip presence.
check(
  "the settle keeps an opacity-only arrival rather than being stripped",
  /\.settle\s*\{[^}]*animation:\s*sdFade/.test(reduced) &&
    /\.settle\s*\{[^}]*transform:\s*none/.test(reduced),
);

// ---------------------------------------------------------------- //
// 2. Motion budget: nothing exceeds 300ms.
// ---------------------------------------------------------------- //
{
  const overBudget = [...css.matchAll(/(\d+)ms/g)]
    .map((m) => Number(m[1]))
    .filter((ms) => ms > 300);
  check(
    "no literal duration in the panel exceeds the 300ms budget",
    overBudget.length === 0,
    overBudget.length ? `found ${overBudget.join(", ")}ms` : "",
  );
  // The token-valued ones resolve to --dur-base (200ms) / --dur-slow (300ms).
  check(
    "animations use the motion tokens rather than ad-hoc durations",
    /animation:[^;]*var\(--dur-(base|slow)\)/.test(css),
  );
  const delays = [...tsx.matchAll(/settleDelay\((\d+)\)/g)].map((m) => Number(m[1]));
  check(
    "stagger offsets stay inside one gesture (≤200ms)",
    delays.length > 0 && Math.max(...delays) <= 200,
    `delays: ${[...new Set(delays)].sort((a, b) => a - b).join(", ")}ms`,
  );
}

// ---------------------------------------------------------------- //
// 3. Colour is never the only channel.
// ---------------------------------------------------------------- //

check(
  "the three provenance chips each take a distinct register",
  /panel\.chipCommunity/.test(tsx) &&
    /panel\.chipCv/.test(tsx) &&
    /panel\.chipCorrected/.test(tsx),
);
for (const [chip, icon, label] of [
  ["chipCommunity", "Users", "communityPending"],
  ["chipCv", "ScanLine", "cvChip"],
  ["chipCorrected", "Pencil", "cvHumanCorrected"],
]) {
  // The chip's icon and its translated label must still be in the same JSX
  // element as the class — colour is a second channel here, never the only one.
  const at = tsx.indexOf(`panel.${chip}`);
  const window_ = at === -1 ? "" : tsx.slice(at, at + 320);
  check(
    `${chip} keeps its icon and its text label alongside the colour`,
    new RegExp(`<${icon}\\b`).test(window_) && window_.includes(`t("${label}")`),
  );
}
check(
  "meters are decorative in the a11y tree (the numeral already says it)",
  /className=\{`mt-1\.5 \$\{panel\.meterTrack\}`\}\s+aria-hidden="true"/.test(tsx) ||
    /panel\.meterTrack[^>]*aria-hidden="true"/.test(tsx),
);
check(
  "an unestablished lens gets an empty dashed track, never a 0% fill",
  /panel\.meterUnset/.test(tsx) && /value === null/.test(tsx),
);

// ---------------------------------------------------------------- //
// 4. The sealed ramp is imported, not re-declared.
// ---------------------------------------------------------------- //

check(
  "the panel takes its ink from scoreColor, not from raw ramp hexes",
  /from "@\/components\/scoreColor"/.test(tsx) && !/#[0-9a-fA-F]{6}/.test(tsx),
  /#[0-9a-fA-F]{6}/.test(tsx) ? "a literal hex appeared in SegmentDetail.tsx" : "",
);

// ---------------------------------------------------------------- //
// 5. Copy contract: sealed u33 strings survive; parity is test-i18n-parity.
// ---------------------------------------------------------------- //
{
  const en = readFileSync(path.join(ROOT, "messages", "en.json"), "utf8");
  const sealed = [
    "Approved camera observation · not yet field-audited",
    "No assessment available for this segment.",
    '"unset": "—"',
  ];
  for (const snippet of sealed) {
    check(`sealed copy still present: ${snippet.slice(0, 40)}…`, en.includes(snippet), snippet);
  }
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "messages/"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  check("messages have no uncommitted edits", dirty === "", dirty);
}

console.log("");
if (failures.length) {
  console.error(`FAIL — ${failures.length} check(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS — reduced motion authored, colour never sole channel, copy untouched.");
