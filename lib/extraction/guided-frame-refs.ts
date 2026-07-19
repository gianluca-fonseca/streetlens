/**
 * Frame-reference parsing for reviewer dialogue.
 *
 * Reviewers cite frames as `#14` or ranges `#1-9` (also `#1–9` with an en-dash).
 * The UI turns valid refs into clickable pills; invalid refs stay marked so the
 * reviewer sees the typo rather than a silent drop.
 *
 * Pure: text in, tokens out. No I/O.
 */

export type FrameRefToken =
  | { kind: "text"; value: string }
  | { kind: "ref"; raw: string; from: number; to: number; valid: boolean }
  | { kind: "invalid"; raw: string };

/** A single frame index or an inclusive range, after validation against known seqs. */
export type ResolvedFrameRef = {
  raw: string;
  from: number;
  to: number;
  /** Every seq in [from, to] that exists on the segment (sorted ascending). */
  seqs: number[];
  valid: boolean;
};

/**
 * Match `#N`, `#N-M`, `#N–M` (en-dash). Captures the digits; the full match
 * includes the leading `#`.
 */
const REF_RE = /#(\d+)(?:\s*[-–]\s*(\d+))?/g;

/**
 * Tokenize a message into plain text and frame-ref spans (not yet validated).
 * Adjacent text is kept; refs keep their original spelling for the pills.
 */
export function tokenizeFrameRefs(text: string): FrameRefToken[] {
  const tokens: FrameRefToken[] = [];
  let last = 0;
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: "text", value: text.slice(last, m.index) });
    }
    const from = Number(m[1]);
    const toRaw = m[2] !== undefined ? Number(m[2]) : from;
    const raw = m[0];
    if (!Number.isFinite(from) || !Number.isFinite(toRaw) || from < 1 || toRaw < 1) {
      tokens.push({ kind: "invalid", raw });
    } else {
      const lo = Math.min(from, toRaw);
      const hi = Math.max(from, toRaw);
      tokens.push({ kind: "ref", raw, from: lo, to: hi, valid: true });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) {
    tokens.push({ kind: "text", value: text.slice(last) });
  }
  return tokens;
}

/**
 * Validate refs against the set of frame seqs that exist for this segment.
 * A range is valid when at least one seq in [from, to] exists; invalid when
 * none do (or the numbers were unusable).
 */
export function resolveFrameRefs(
  text: string,
  knownSeqs: ReadonlySet<number> | readonly number[],
): ResolvedFrameRef[] {
  const known = knownSeqs instanceof Set ? knownSeqs : new Set(knownSeqs);
  const out: ResolvedFrameRef[] = [];
  for (const tok of tokenizeFrameRefs(text)) {
    if (tok.kind === "text") continue;
    if (tok.kind === "invalid") {
      out.push({ raw: tok.raw, from: 0, to: 0, seqs: [], valid: false });
      continue;
    }
    const seqs: number[] = [];
    for (let s = tok.from; s <= tok.to; s++) {
      if (known.has(s)) seqs.push(s);
    }
    out.push({
      raw: tok.raw,
      from: tok.from,
      to: tok.to,
      seqs,
      valid: seqs.length > 0,
    });
  }
  return out;
}

/** Unique, sorted seqs cited by valid refs in the message. */
export function referencedSeqs(
  text: string,
  knownSeqs: ReadonlySet<number> | readonly number[],
): number[] {
  const seen = new Set<number>();
  for (const ref of resolveFrameRefs(text, knownSeqs)) {
    if (!ref.valid) continue;
    for (const s of ref.seqs) seen.add(s);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Re-tokenize with validity against known seqs, for UI pills.
 * Invalid refs become `kind: "invalid"` so the renderer can mark them.
 */
export function tokenizeFrameRefsValidated(
  text: string,
  knownSeqs: ReadonlySet<number> | readonly number[],
): FrameRefToken[] {
  const known = knownSeqs instanceof Set ? knownSeqs : new Set(knownSeqs);
  return tokenizeFrameRefs(text).map((tok) => {
    if (tok.kind !== "ref") return tok;
    let hit = false;
    for (let s = tok.from; s <= tok.to; s++) {
      if (known.has(s)) {
        hit = true;
        break;
      }
    }
    if (!hit) return { kind: "invalid" as const, raw: tok.raw };
    return { ...tok, valid: true };
  });
}
