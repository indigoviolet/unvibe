/**
 * Explain-terms highlight helpers (issue #418).
 *
 * Picked terms highlight where they were picked: a plain `<mark
 * data-explain-term="<id>">` wrapped around the selected slice. The marks
 * are direct DOM edits (React doesn't know them); they are removed when
 * picking ends (Cancel, Escape, another card's picker) and as soon as a
 * Rewrite starts — always before any rewrite can change the text, so
 * they can never go stale.
 */

const ATTR = "data-explain-term";

/** Wrap the range's slice in a term mark. Single-text-node ranges only. */
export function highlightExplainTerm(range: Range, id: string): boolean {
  if (range.collapsed) return false;
  if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) return false;
  const mark = document.createElement("mark");
  mark.setAttribute(ATTR, id);
  try {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  } catch {
    return false;
  }
  return true;
}

/** Remove one term's marks (its × in the tray). */
export function unhighlightExplainTerm(id: string): void {
  for (const el of document.querySelectorAll(`mark[${ATTR}="${CSS.escape(id)}"]`)) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
}

/** Remove every term mark (picking ends, Rewrite starts). */
export function clearExplainHighlights(): void {
  for (const el of document.querySelectorAll(`mark[${ATTR}]`)) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
}
