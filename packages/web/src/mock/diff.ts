/**
 * Mock diff fixture: the real urllib3/urllib3#5020 diff embedded in
 * `prototype.html` (`<script id="diffs">`, see `rawDiffs.ts`), parsed into
 * the shared `ReviewFile` / `Hunk` shapes exactly as Service M1 ingest will
 * produce them (PRD §4.13, §11 step 1).
 *
 * Parsing mirrors the prototype's own parser (hunk split on `@@` lines,
 * ≤3 context lines kept by git itself) plus the shared-contract extras:
 * old/new ranges, added/removed counts, `hiddenReason`, deterministic
 * `contentHash` (ignores line numbers and whitespace, PRD §8), and the
 * per-line `lines` array (added to `@unvibe/shared` for M1-web).
 */
import type { FileCategory, Hunk, HunkLine, ReviewFile } from "@unvibe/shared";
import { RAW_DIFFS } from "./rawDiffs.js";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const FN_RE = /(?:def|class)\s+(\w+)/;
const COMMENT_RE = /^\s*#/;
const IMPORT_RE = /^(from |import |\)|[A-Za-z_]+,$)/;

function categorize(path: string, gen: boolean): FileCategory {
  if (gen) return "generated";
  if (/(^|\/)tests?\//.test(path) || /(^|\/)test_/.test(path)) return "tests";
  if (/\.(md|rst)$/.test(path) || /(^|\/)(changelog|docs)\//.test(path)) return "docs";
  if (/\.(py|pyi|js|ts|tsx|go|rs|java)$/.test(path)) return "source";
  return "config";
}

/** FNV-1a hex: deterministic content hash over normalized hunk content. */
export function hashHunkContent(rows: { kind: string; text: string }[]): string {
  let h = 0x811c9dc5;
  for (const r of rows) {
    const s = `${r.kind}:${r.text.replace(/\s+/g, "")}\n`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Prototype's rule-based "uninteresting" classification (M2 agents judge). */
function autoReason(category: FileCategory, gen: boolean, hunk: Hunk): string | undefined {
  if (gen || category === "generated") return "generated";
  if (category === "docs" || category === "config") return "docs / config";
  const changed = (hunk.lines ?? [])
    .filter((l) => l.kind !== "ctx")
    .map((l) => l.text.trim())
    .filter(Boolean);
  if (changed.length > 0 && changed.every((c) => IMPORT_RE.test(c))) return "imports";
  return undefined;
}

export interface ParsedHunk extends Hunk {
  /** Function/class trailing the `@@` header, if any. */
  fn: string | null;
  /** True for `#`-comment code lines (rendered muted, like the prototype). */
  commentLines: boolean[];
}

function parseHunks(rawDiff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let cur: {
    header: string;
    context: string;
    oldStart: number;
    newStart: number;
    o: number;
    n: number;
    lines: HunkLine[];
  } | null = null;

  const flush = (): void => {
    if (!cur) return;
    const added = cur.lines.filter((l) => l.kind === "add").length;
    const removed = cur.lines.filter((l) => l.kind === "del").length;
    const fn = cur.context.match(FN_RE)?.[1] ?? null;
    const hunk: ParsedHunk = {
      contentHash: hashHunkContent(cur.lines),
      header: cur.header,
      context: cur.context || undefined,
      newStart: cur.newStart,
      newEnd: cur.n - 1,
      oldStart: cur.oldStart,
      oldEnd: cur.o - 1,
      added,
      removed,
      lines: cur.lines,
      fn,
      commentLines: cur.lines.map((l) => COMMENT_RE.test(l.text)),
    };
    hunks.push(hunk);
    cur = null;
  };

  for (const line of rawDiff.split("\n")) {
    const m = line.match(HUNK_RE);
    if (m) {
      flush();
      cur = {
        header: line,
        context: m[5] ?? "",
        oldStart: Number(m[1]),
        newStart: Number(m[3]),
        o: Number(m[1]),
        n: Number(m[3]),
        lines: [],
      };
      continue;
    }
    if (!cur || line.startsWith("\\")) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      cur.lines.push({ kind: "add", newLine: cur.n++, text });
    } else if (marker === "-") {
      cur.lines.push({ kind: "del", oldLine: cur.o++, text });
    } else if (marker === " ") {
      cur.lines.push({ kind: "ctx", oldLine: cur.o++, newLine: cur.n++, text });
    }
    // diff --git / index / --- / +++ preamble lines are ignored.
  }
  flush();
  return hunks;
}

export function parseFileDiff(key: string, path: string, gen: boolean, rawDiff: string): ReviewFile {
  const hunks = parseHunks(rawDiff);
  const category = categorize(path, gen);
  for (const h of hunks) {
    const reason = autoReason(category, gen, h);
    if (reason) h.hiddenReason = reason;
  }
  return { fileKey: key, path, category, hunks };
}

/** The four fixture files, in prototype order. */
export const MOCK_FILES: ReviewFile[] = RAW_DIFFS.map((f) => parseFileDiff(f.key, f.path, f.gen, f.diff));

/** Canned agent hunk summaries (prototype `HSUM`), keyed `fileKey:index`. */
export const HUNK_SUMMARIES: Record<string, string> = {
  "conn:0":
    "Adds `_OBSOLETE_FOLD_RE` and two helpers. `_normalize_header_value` turns each fold into one space, with a fast path for values without CRLF. `_normalize_header_values` applies it to every header and, if anything changed, rewrites the original `HTTPMessage` in place, keeping order and duplicates.",
  "conn:1":
    "`getresponse()` now builds `HTTPHeaderDict` from the normalized header list instead of the raw `HTTPMessage` items. This is the only call site.",
  "tconn:0": "Imports `HTTPMessage` for the new unit test.",
  "tconn:1": "Imports the two new helpers.",
  "tconn:2":
    "Unit tests: the value helper on four inputs (including two adjacent folds), and the message helper preserving order, duplicates, payload, defects and policy.",
  "tsock:0": "Imports `HTTPResponse` for an isinstance check.",
  "tsock:1":
    "Socket-level test: a real response with folded `Set-Cookie` and every SP/HTAB combination around CRLF, checked through both `r.headers` and the original message.",
  "log:0": "Changelog entry for the fix.",
};

/**
 * One-line "why it's skippable" copy for the hidden hunks (prototype
 * `BRIEF`; M2's hunk pass will produce these per hunk with reasons).
 */
export const HUNK_BRIEFS: Record<string, string> = {
  "tconn:0": "Imports `HTTPMessage` for the new unit test.",
  "tconn:1": "Imports the two new helpers for testing.",
  "tsock:0": "Imports `HTTPResponse` for an isinstance check.",
  "log:0": "Changelog entry describing the fix; no code.",
};
