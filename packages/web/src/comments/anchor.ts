/**
 * Anchor highlighting (comments owner; PRD §4.8, §8).
 *
 * Reusable by the interaction agent's Explain/expansion cards: everything
 * here works on plain text-node lists or Elements, with no store access.
 *
 * - `locateQuoteSegments` (pure): find `quote` in the concatenation of
 *   `texts` and return the per-node slices to wrap. Handles quotes that
 *   span inline markup (e.g. `<code>foo</code> bar` for quote "foo bar"),
 *   which a per-node `indexOf` misses.
 * - `markTextInElement` / `highlightQuoteInElement` (DOM): wrap the located
 *   slices in `make()` marks, skipping `.lo` marker rows like the prototype.
 * - `highlightAnchorInRoot` (DOM): try every `[data-top="top"]` host in
 *   order; the first host containing the quote wins.
 */

export interface QuoteSegment {
  /** Index into the `texts` array. */
  node: number;
  start: number;
  end: number;
}

/**
 * Locate `quote` in `texts.join("")`. Returns the covering per-node
 * segments, or `null` when the quote is absent (callers fall back to the
 * comment marker). Empty quotes never match.
 */
export function locateQuoteSegments(texts: string[], quote: string): QuoteSegment[] | null {
  if (!quote) return null;
  const joined = texts.join("");
  const at = joined.indexOf(quote);
  if (at < 0) return null;
  const end = at + quote.length;
  const segments: QuoteSegment[] = [];
  let offset = 0;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const nodeStart = offset;
    const nodeEnd = offset + text.length;
    offset = nodeEnd;
    const overlapStart = Math.max(at, nodeStart);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapStart < overlapEnd) {
      segments.push({ node: i, start: overlapStart - nodeStart, end: overlapEnd - nodeStart });
    }
    if (nodeEnd >= end) break;
  }
  return segments.length > 0 ? segments : null;
}

/** Split `text` around the first occurrence of `quote` (pure helper). */
export function splitOnQuote(
  text: string,
  quote: string,
): { before: string; match: string; after: string } | null {
  if (!quote) return null;
  const at = text.indexOf(quote);
  if (at < 0) return null;
  return { before: text.slice(0, at), match: quote, after: text.slice(at + quote.length) };
}

function collectTextNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest(".lo")) continue;
    out.push(text);
  }
  return out;
}

/**
 * Wrap the first occurrence of `quote` inside `el` with `make()` marks.
 * Quotes spanning several text nodes (inline code, links) produce one mark
 * per intersecting node. Returns the number of marks created (0 = not
 * found, so the caller falls back to the comment marker).
 */
export function markTextInElement(el: Element, quote: string, make: () => Element): number {
  if (!quote) return 0;
  const nodes = collectTextNodes(el);
  if (nodes.length === 0) return 0;
  const segments = locateQuoteSegments(nodes.map((n) => n.data), quote);
  if (!segments) return 0;
  // Wrap from the last segment backwards so earlier offsets stay valid.
  let created = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const node = nodes[seg.node];
    try {
      const range = document.createRange();
      range.setStart(node, seg.start);
      range.setEnd(node, seg.end);
      range.surroundContents(make());
      created++;
    } catch {
      // A range splitting an element (shouldn't happen for single-text-node
      // slices) is skipped rather than breaking the whole highlight.
    }
  }
  return created;
}

/**
 * Highlight `quote` under the first `[data-top="top"]` host in `root` that
 * contains it. Returns true when highlighted (no marker needed), false when
 * the caller should fall back to the comment marker (PRD §4.8: anchor text
 * that can no longer be found).
 */
export function highlightAnchorInRoot(
  root: ParentNode,
  top: string,
  quote: string,
  make: () => Element,
): boolean {
  if (!quote) return false;
  const hosts = root.querySelectorAll(`[data-top="${CSS.escape(top)}"]`);
  for (const host of hosts) {
    if (markTextInElement(host, quote, make) > 0) return true;
  }
  return false;
}

/** Remove all anchor marks created by `make` (class `anc` by default). */
export function clearAnchorMarks(root: ParentNode, cls = "anc"): void {
  for (const mark of [...root.querySelectorAll(`mark.${cls}`)]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}
