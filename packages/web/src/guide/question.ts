/**
 * ? mode highlight helpers (issue #388).
 *
 * Picked terms highlight where they were picked: a plain `<mark
 * data-qterm="<id>">` wrapped around the selected slice. The marks are
 * direct DOM edits (React doesn't know them); they are removed when the
 * mode turns off, on Cancel, and as soon as a Rewrite starts — always
 * before any rewrite can change the text, so they can never go stale.
 */

const ATTR = "data-qterm";

/** Wrap the range's slice in a term mark. Single-text-node ranges only. */
export function highlightQuestionTerm(range: Range, id: string): boolean {
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
export function unhighlightQuestionTerm(id: string): void {
  for (const el of document.querySelectorAll(`mark[${ATTR}="${CSS.escape(id)}"]`)) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
}

/** Remove every term mark (mode off, Cancel, Rewrite start). */
export function clearQuestionHighlights(): void {
  for (const el of document.querySelectorAll(`mark[${ATTR}]`)) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }
}
