/**
 * Rule-based "uninteresting" pre-classification (ingest, PRD §20).
 *
 * Stored as the hunk's `hidden_reason`; a later agent pass refines it (M2
 * hunk pass). Vocabulary matches the prototype (`generated`, `docs /
 * config`, `imports`) so hidden-row reasons stay familiar.
 *
 * Rules:
 * - Generated-file hunks → "generated".
 * - Docs/config-file hunks → "docs / config".
 * - Import-only hunks → "imports" (language-agnostic statement list).
 * - One-line changes (a single changed row) are NEVER hidden.
 */
import type { FileCategory } from "@unvibe/shared";
import type { ParsedHunk } from "./diff.js";

// Import/export/include statements across common languages, plus structural
// continuation rows (closers, trailing-comma name lists). All matched
// against the whitespace-trimmed row text.
const IMPORT_LINE =
  /^(?:from\s+\S+\s+import\s|import\s|export\s+(?:.*\s+from\s+)?|#include\s|using\s+[\w:.]+\s*;|use\s+[\w:]+)/;
const CONTINUATION_LINE = /^[)},\]]/;
/** A bare name in a multi-line import list: `Name,` or `"name",`. */
const NAME_LIST_LINE = /^["']?[\w$.*{}[\] ]+["']?,$/;

export interface UninterestingOptions {
  category: FileCategory;
  /** True when `.gitattributes` marks the file linguist-generated. */
  generatedFlag?: boolean;
}

/**
 * One-line hide reason, or `undefined` when the hunk stays visible.
 * Pure.
 */
export function uninterestingReason(hunk: ParsedHunk, opts: UninterestingOptions): string | undefined {
  const changedRows = hunk.lines.filter((l) => l.kind !== "ctx");
  // One-line changes are never hidden (PRD §4.13).
  if (changedRows.length <= 1) return undefined;

  if (opts.generatedFlag === true || opts.category === "generated") return "generated";
  if (opts.category === "docs" || opts.category === "config") return "docs / config";

  const changed = changedRows.map((l) => l.text.trim()).filter(Boolean);
  if (changed.length === 0) return undefined;
  const allImports = changed.every(
    (c) => IMPORT_LINE.test(c) || CONTINUATION_LINE.test(c) || NAME_LIST_LINE.test(c),
  );
  if (allImports) return "imports";
  return undefined;
}
