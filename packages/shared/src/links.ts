/**
 * Link-token parsing (PRD §10).
 *
 * Agents write Markdown with inline tokens:
 *   `[[diff:sp:147-152]]`, `[[code:src/x.py:10-20]]`, `[[desc:d-table]]`,
 *   `[[card:central#p-rule]]`, `[[page:f-522]]`,
 *   `[[concept:idempotency|idempotency]]`
 *
 * This module only parses tokens out of Markdown text: it finds `[[…]]`
 * spans (with optional `|label`) and returns structured tokens + positions.
 * Validation against a review (existence, ranges, anchors) comes later.
 */

import { parseId } from "./ids.js";

export interface LinkToken {
  /** Full matched text, e.g. `[[concept:idempotency|idempotency]]`. */
  raw: string;
  /** Text between the brackets before the `|`, e.g. `concept:idempotency`. */
  idText: string;
  /** Optional display label after the `|`. */
  label?: string;
  /** Offset of `[[` in the source. */
  start: number;
  /** Offset just past `]]` in the source. */
  end: number;
}

/**
 * Find all `[[…]]` tokens in Markdown text.
 *
 * Rules:
 * - `[[` opens a token; the token ends at the first `]]` after it.
 * - Empty targets are ignored.
 * - The label may not contain `[` or `]` (a `|` inside the label is kept
 *   as part of the label: split on first `|`).
 * - The target may contain `[` and `]` for paths with brackets (issue
 *   #332: Next.js route groups and dynamic segments, e.g.
 *   `[[code:src/app/(group)/items/[id]/page.tsx:433-492]]`). Such a
 *   target must parse as a real ID (`parseId`); anything else with
 *   brackets stays literal so casual `[[…]]` prose is never eaten.
 * - A nested `[[` inside the target is never a token: scanning resumes
 *   just inside the outer open so the inner token is still found.
 * - Fenced code spans are NOT skipped here — callers that need that should
 *   strip code first. Documented so later agents know the boundary.
 * - Unclosed `[[` is ignored.
 */
export function tokenizeLinks(text: string): LinkToken[] {
  const out: LinkToken[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[[", i);
    if (open < 0) break;
    const close = text.indexOf("]]", open + 2);
    if (close < 0) break;
    const inner = text.slice(open + 2, close);
    const pipe = inner.indexOf("|");
    const idText = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
    const label = pipe < 0 ? undefined : inner.slice(pipe + 1);
    const labelOk = label === undefined || (!label.includes("[") && !label.includes("]"));
    const bracketed = idText.includes("[") || idText.includes("]");
    const ok =
      idText !== "" &&
      labelOk &&
      !idText.includes("[[") &&
      (!bracketed || parseId(idText) !== null);
    if (!ok) {
      // Not a token at this open: rescan from just inside it so a real
      // token nested in the rejected span is still found.
      i = open + 2;
      continue;
    }
    out.push({
      raw: text.slice(open, close + 2),
      idText,
      ...(label !== undefined ? { label } : {}),
      start: open,
      end: close + 2,
    });
    i = close + 2;
  }
  return out;
}

/**
 * Render Markdown with link tokens replaced by a callback. Non-token text
 * passes through unchanged. Useful for both display and server-side stripping
 * of the trailing structured JSON block (handled elsewhere).
 */
export function replaceLinkTokens(
  text: string,
  fn: (token: LinkToken) => string,
): string {
  const tokens = tokenizeLinks(text);
  if (!tokens.length) return text;
  let out = "";
  let pos = 0;
  for (const t of tokens) {
    out += text.slice(pos, t.start) + fn(t);
    pos = t.end;
  }
  return out + text.slice(pos);
}
