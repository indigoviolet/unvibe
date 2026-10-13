/**
 * Code-cell HTML strings (issue #101).
 *
 * Diff code cells render through `dangerouslySetInnerHTML` (see
 * `FileSection`): the cell's text nodes are anonymous, never React
 * children, so anchor marks may wrap, split and merge them freely — React
 * only ever swaps the whole HTML string. The rule for every highlight
 * pass in this app is the same: mutate only inside a container React
 * treats as opaque. Plain runs stay spanless, exactly as the React
 * version did, so copy-paste text carries no artefacts.
 */
import { escapeHtml } from "../../../components/escapeHtml.js";
import type { LineTokens } from "./tokenize.js";

/** Class string for one token run (mirrors `CodeSegs` in `FileSection`). */
export function segClass(cls: string | null, bold: boolean, italic: boolean): string {
  return [cls, bold ? "shk-b" : "", italic ? "shk-i" : ""].filter(Boolean).join(" ");
}

/** One code line as HTML: escaped text, coloured runs in spans. */
export function codeLineHtml(text: string, segs: LineTokens | null): string {
  if (segs === null) return escapeHtml(text);
  return segs
    .map((s) => {
      const cls = segClass(s.cls, s.bold, s.italic);
      const body = escapeHtml(s.text);
      return cls === "" ? body : `<span class="${cls}">${body}</span>`;
    })
    .join("");
}
