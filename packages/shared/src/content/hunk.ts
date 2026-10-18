/**
 * Hunk-pass reply tolerance (issue #99).
 *
 * `prompts/hunk_pass.md` asks for one Markdown line plus a fenced `json`
 * block carrying `{"hunk": {"summary", "hiddenReason"}}`, but the hunk jobs
 * run on the small model with an empty system prompt, so format slips are
 * expected: the model may send the object bare (no fence), with no Markdown
 * line, or with trailing prose after the JSON. Both hunk call sites
 * (`summarizeHunk` and the hunk-pass stage) read replies through this one
 * helper, so the tolerant parse lives in exactly one place.
 *
 * Strategy: prefer the `splitReply` result the caller already computed
 * (canonical shape, fenced with or without the Markdown line, trailing
 * prose after the fence). Only when that carries no usable `hunk` object,
 * scan the raw text for a fenced or bare JSON object holding one. The
 * Markdown-line fallback never yields text that looks like JSON, and a
 * genuinely summary-less reply yields no summary rather than garbage (the
 * diff pane shows its Summarize action again for those hunks).
 */
import type { ReplyData } from "./types.js";
import { normalizeHunkScore, type HunkScoreLevel } from "../scores.js";
import { findFences } from "./split.js";

/** Model instruction budget for the summary line (prompt `hunk_pass.md`). */
export const HUNK_SUMMARY_MAX = 140;

export interface HunkReplyResult {
  /** Absent when no usable summary could be read: store none, not garbage. */
  summary?: string;
  hiddenReason: string | null;
  /**
   * Issue #169: the agent's score level, or null when it sent none (or
   * an invented one). The caller resolves it against the deterministic
   * rules (`resolveHunkScore`), so this stays the raw reading.
   */
  score: HunkScoreLevel | null;
}

/**
 * True when the text looks like raw JSON or a code fence rather than a
 * human-readable summary. Used to reject fallback lines when reading a
 * fresh agent reply.
 */
export function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[") || t.startsWith("```");
}

function usableSummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (s === "" || looksLikeJson(s)) return undefined;
  return s;
}

function usableHiddenReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s === "" ? null : s;
}

/** Null when the value holds no `hunk` object at all. */
function hunkFromObject(obj: unknown): { summary?: string; hiddenReason?: string | null; score?: HunkScoreLevel | null } | null {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const hunk = (obj as Record<string, unknown>)["hunk"];
  if (typeof hunk !== "object" || hunk === null || Array.isArray(hunk)) return null;
  const rec = hunk as Record<string, unknown>;
  return {
    summary: usableSummary(rec["summary"]),
    hiddenReason: usableHiddenReason(rec["hiddenReason"]),
    score: normalizeHunkScore(rec["score"]),
  };
}

/** Balanced-brace scan from `text[start] === "{"`; null when unbalanced. */
function scanBalanced(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Every `{…}` object in the reply, in order (skips unbalanced tails). */
function bareJsonCandidates(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    const candidate = scanBalanced(text, start);
    if (candidate === null) {
      i = start + 1;
    } else {
      out.push(candidate);
      i = start + candidate.length;
    }
  }
  return out;
}

/** `[[target]]` / `[[target|label]]` tokens to plain text (label or nothing). */
function stripLinkTokens(line: string): string {
  return line
    .replace(/\[\[([^\]|[\]]*)(?:\|([^\]]*))?\]\]/g, (_m, _target, label) => (typeof label === "string" ? label : ""))
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Shorten to `max` chars on a word boundary with an ellipsis, never
 * mid-word. A single over-long word has no boundary: hard-cut it.
 */
export function truncateAtWordBoundary(text: string, max: number = HUNK_SUMMARY_MAX): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace <= 0) return `${cut}…`;
  return `${cut.slice(0, lastSpace)}…`;
}

/**
 * First Markdown line usable as a summary: skips blanks, fence markers and
 * everything inside fences, and anything that looks like JSON. Undefined
 * when nothing usable is left.
 */
function fallbackSummary(text: string): string | undefined {
  const lines = text.split("\n");
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "" || looksLikeJson(line)) continue;
    const plain = stripLinkTokens(line);
    if (plain === "" || looksLikeJson(plain)) continue;
    return truncateAtWordBoundary(plain);
  }
  return undefined;
}

/**
 * Read one hunk-pass reply. `data` is the `splitReply` result the caller
 * already computed (null when the reply carries no trailing fence); the raw
 * `text` is scanned for fenced or bare JSON only when `data` has no usable
 * `hunk` object. A model-provided summary is kept whole (the 140-char limit
 * is an instruction to the model, not a storage cut); only the Markdown
 * fallback is shortened, on a word boundary.
 */
export function parseHunkReply(text: string, data?: ReplyData | null): HunkReplyResult {
  const fromData = data ? hunkFromObject(data) : null;
  if (fromData?.summary !== undefined) {
    return { summary: fromData.summary, hiddenReason: fromData.hiddenReason ?? null, score: fromData.score ?? null };
  }
  let hiddenReason = fromData?.hiddenReason ?? null;
  let score = fromData?.score ?? null;
  const attempt = (candidate: string): string | undefined => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return undefined;
    }
    const found = hunkFromObject(parsed);
    if (!found) return undefined;
    if (found.hiddenReason != null && hiddenReason == null) hiddenReason = found.hiddenReason;
    if (found.score != null && score == null) score = found.score;
    return found.summary;
  };
  // Earlier fenced blocks first (last-to-first, agreeing with splitReply's
  // "last fence wins"), then bare objects in reply order.
  const fenced = findFences(text)
    .filter((f) => f.info === "" || f.info === "json" || f.info === "jsonc")
    .map((f) => f.content)
    .reverse();
  for (const candidate of fenced) {
    const summary = attempt(candidate);
    if (summary !== undefined) return { summary, hiddenReason, score };
  }
  for (const candidate of bareJsonCandidates(text)) {
    const summary = attempt(candidate);
    if (summary !== undefined) return { summary, hiddenReason, score };
  }
  const fallback = fallbackSummary(text);
  if (fallback === undefined) return { hiddenReason, score };
  return { summary: fallback, hiddenReason, score };
}
