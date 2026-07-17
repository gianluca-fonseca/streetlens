#!/usr/bin/env node

/**
 * The mp4box facts the demux is built on.
 *
 * This is not a test of our code. It is a test of an assumption about somebody
 * else's, and it exists because one of those assumptions was wrong in a way that
 * could not have been caught by anything else we have.
 *
 * `createFile(keepMdatData = false)` builds `new ISOFile(stream, !keepMdatData)`.
 * So the reading that looks obviously right, "pass false, do not keep the big
 * mdat payloads, save memory", sets `discardMdatData = true` and throws away the
 * exact bytes the samples are made of. mp4box does not fail. It logs "samples
 * will not be extracted" at warn level and returns a perfectly well-formed
 * stream of nothing. Extraction then reports zero frames, truthfully, forever.
 *
 * The flag is inverted, it is silent, and getting it wrong is invisible in every
 * count we have. So it gets pinned here, against the real package rather than
 * against a memory of the docs. If mp4box ever flips the default, this fails
 * loudly instead of the funnel quietly extracting nothing.
 *
 * Plain ESM on purpose: mp4box is ESM-only, so the repo's CommonJS test harness
 * cannot require() it. There is no TypeScript to compile here.
 *
 * Run: node scripts/test-mp4box-contract.mjs
 */

import { createFile, MP4BoxBuffer } from "mp4box";

const failures = [];
function check(label, ok, detail = "") {
  console.log(`  [${ok ? "ok " : "FAIL"}] ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function main() {
  /* ---------------- The inverted flag ---------------- */

  check(
    "createFile(true) keeps the sample bytes",
    createFile(true).discardMdatData === false,
    `discardMdatData=${createFile(true).discardMdatData}`,
  );

  // The trap, asserted explicitly so the next person reading video-demux.ts can
  // see WHY it passes true rather than having to trust a comment.
  check(
    "createFile(false) would silently discard them",
    createFile(false).discardMdatData === true,
    `discardMdatData=${createFile(false).discardMdatData}`,
  );

  check(
    "the default is the discarding one",
    createFile().discardMdatData === true,
    "so the argument is never optional for us",
  );

  /* ---------------- What the demux actually calls ---------------- */

  const iso = createFile(true);
  for (const method of [
    "appendBuffer",
    "flush",
    "start",
    "setExtractionOptions",
    "releaseUsedSamples",
    "getTrackById",
  ]) {
    check(`ISOFile.${method} exists`, typeof iso[method] === "function");
  }

  check(
    "MP4BoxBuffer.fromArrayBuffer carries the fileStart",
    MP4BoxBuffer.fromArrayBuffer(new ArrayBuffer(8), 4096).fileStart === 4096,
  );

  /* ---------------- Garbage in ---------------- */

  // The picker hands us whatever the contributor chose. A text file must not
  // take the tab down; it has to surface as a parse failure the UI can name.
  const junk = createFile(true);
  let threw = null;
  try {
    const bytes = new TextEncoder().encode("this is not a video, it is a letter");
    junk.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.buffer, 0), true);
    junk.flush();
  } catch (error) {
    threw = error;
  }
  check(
    "a non-video file does not crash the parser",
    threw === null,
    threw ? `threw ${threw.message}` : "",
  );
  check("a non-video file yields no moov", !junk.moov);

  console.log(
    failures.length === 0
      ? "\nPASS — mp4box still behaves the way video-demux.ts assumes"
      : `\nFAIL — ${failures.length} failing: ${failures.join(", ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
