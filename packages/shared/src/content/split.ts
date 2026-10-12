/**
 * `splitReply`: separate an agent reply's trailing fenced JSON block
 * (PRD §10) from its Markdown body.
 *
 * Tolerated: trailing whitespace after the fence, a `json`/`jsonc`/empty
 * language tag, and non-fence prose after the block (ignored). Earlier
 * fenced code blocks (examples, diagrams) are content, never the trailer:
 * only the LAST fenced block in the reply can be the trailer.
 *
 * Never throws: a missing or malformed trailer is a typed {@link SplitError}.
 */
import type { ReplyData, SplitError, SplitResult } from "./types.js";

interface Fence {
  start: number;
  end: number;
  info: string;
  content: string;
}

export type { Fence as FencedBlock };

export function findFences(text: string): Fence[] {
  const out: Fence[] = [];
  const lines = text.split("\n");
  // Byte offset of each line start.
  const offsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1; // +1 for the "\n" we split on
  }
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^```\s*([A-Za-z0-9_-]*)\s*$/);
    if (!open) {
      i++;
      continue;
    }
    const info = open[1] ?? "";
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    if (j >= lines.length) {
      // Unclosed fence: not a trailer candidate, and nothing after it can
      // be one either (a trailer needs its closing fence).
      break;
    }
    out.push({
      start: offsets[i],
      end: offsets[j] + lines[j].length + 1,
      info: info.toLowerCase(),
      content: lines.slice(i + 1, j).join("\n"),
    });
    i = j + 1;
  }
  return out;
}

/**
 * Split `text` into Markdown body + trailing structured JSON.
 *
 * - `ok: true`: `body` is the Markdown before the fence (trailing
 *   whitespace trimmed), `data` the parsed object, `rawJson` its raw text.
 * - `ok: false` with `missing`: no trailing JSON fence found; `body` is
 *   the whole reply. Callers should send one repair turn only when several
 *   citations also failed validation (see the validator), not for this
 *   alone — most on-demand replies legitimately carry no JSON.
 * - `ok: false` with `malformed`: the last fence claims to be JSON
 *   (`json`/`jsonc` tag) but does not parse; `body` excludes the fence.
 * - `ok: false` with `not-object`: the trailer parses but is not a JSON
 *   object (e.g. an array); `body` excludes the fence.
 */
export function splitReply(text: string): SplitResult {
  const fences = findFences(text);
  if (fences.length === 0) {
    const error: SplitError = {
      kind: "missing",
      message: "no fenced code block found; expected one trailing JSON block",
    };
    return { ok: false, body: text, data: null, error };
  }
  const last = fences[fences.length - 1];
  const claimsJson = last.info === "" || last.info === "json" || last.info === "jsonc";
  if (!claimsJson) {
    const error: SplitError = {
      kind: "missing",
      message: `last fenced block is \`\`\`${last.info}, not JSON`,
    };
    return { ok: false, body: text, data: null, error };
  }
  const body = text.slice(0, last.start).replace(/[ \t\n]+$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(last.content);
  } catch (e) {
    const error: SplitError = {
      kind: "malformed",
      message: `trailing JSON block does not parse: ${(e as Error).message}`,
    };
    return { ok: false, body, data: null, error };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    const error: SplitError = {
      kind: "not-object",
      message: "trailing JSON block must be an object",
    };
    return { ok: false, body, data: null, error };
  }
  return { ok: true, body, data: parsed as ReplyData, rawJson: last.content };
}
