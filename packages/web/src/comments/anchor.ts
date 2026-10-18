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
 *   Idempotent (issue #15): previous marks from the same maker are unwrapped
 *   before re-marking, so N snapshot patches leave depth 1, not N layers.
 * - `highlightAnchorInRoot` (DOM): try every `[data-top="top"]` host in
 *   order; the first host containing the quote wins.
 * - `clearMarks` + `withPreservedSelection` (DOM): effects clear their own
 *   stale marks (deleted / anchor-stale / quote-gone annotations) and redo
 *   all marks inside one selection-preserving window, so the user's text
 *   selection and focused reply box survive re-highlighting.
 *
 * Why post-hoc DOM surgery instead of rendering-time splits: the marked
 * hosts are guide/description/diff prose that React renders via
 * `dangerouslySetInnerHTML` (or plain text the service owns as HTML
 * strings). Teaching every block renderer to split text around each live
 * anchor quote would touch CardView/BlockView/DescriptionBody/DiffView and
 * every e2e-covered behaviour (open/closed styles, hover previews,
 * click-to-expand, inline-code-spanning quotes, marker fallbacks). The
 * effects instead run one frame after React commits (existing `setTimeout`
 * pattern): when block content changes React wipes the marks and the effect
 * re-applies them; when unrelated store patches leave the blocks alone the
 * idempotent re-mark is a no-op for the DOM the user sees.
 *
 * Rule (issue #101): callers may only mark inside containers React treats
 * as opaque — rendered through `dangerouslySetInnerHTML`, never mixed with
 * React children. Wrapping or merging React-owned text nodes (`surround`,
 * `normalize`) detaches nodes React still references, and the next
 * structural render of that subtree throws `removeChild` NotFoundError,
 * which used to blank the whole page. Guide code blocks and diff cells
 * render their text as HTML strings for exactly this reason; description
 * expansions mark only the paragraph body, never the segment div around
 * it; and marker buttons are filtered at render time, never pruned from
 * the DOM.
 */

export interface QuoteSegment {
  /** Index into the `texts` array. */
  node: number;
  start: number;
  end: number;
}

/**
 * Issue #166: an anchor's quoted text plus its recorded selection
 * offsets. Offsets are present only when the anchor came from a live
 * text selection; everything else places by text match.
 */
export interface AnchorSpot {
  quote: string;
  startOffset?: number;
  endOffset?: number;
}

/** Read a spot off a stored anchor (or action payload). */
export function spotFromAnchor(a: {
  quotedText: string;
  startOffset?: number;
  endOffset?: number;
}): AnchorSpot {
  return {
    quote: a.quotedText,
    ...(a.startOffset !== undefined ? { startOffset: a.startOffset } : {}),
    ...(a.endOffset !== undefined ? { endOffset: a.endOffset } : {}),
  };
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
  return segmentsAt(texts, at, quote.length);
}

/** Per-node segments covering `[at, at + length)` of `texts.join("")`. */
function segmentsAt(texts: string[], at: number, length: number): QuoteSegment[] | null {
  const end = at + length;
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

/** Every start index of `needle` in `haystack` (empty needle: none). */
function allOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return out;
    out.push(at);
    from = at + 1;
  }
}

/**
 * Locate `quote` at the occurrence nearest `near` (a recorded offset).
 * Returns the covering per-node segments, or `null` when absent. With
 * `near` 0 this is the first occurrence — today's behaviour for anchors
 * without recorded offsets.
 */
export function locateNearestQuoteSegments(
  texts: string[],
  quote: string,
  near: number,
): QuoteSegment[] | null {
  if (!quote) return null;
  const joined = texts.join("");
  const occ = allOccurrences(joined, quote);
  if (occ.length === 0) return null;
  let best = occ[0];
  for (const at of occ) {
    if (Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  return segmentsAt(texts, best, quote.length);
}

/** Collapse whitespace and trim (matches the toolbar's quote form). */
function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Plain text covered by `segments` of `texts`. */
function coveredSegmentsText(texts: string[], segments: QuoteSegment[]): string {
  return segments.map((s) => texts[s.node].slice(s.start, s.end)).join("");
}

/** Wrap `segments` of `nodes` in `make()` marks (last first). Returns the count. */
function wrapSegments(nodes: Text[], segments: QuoteSegment[], make: () => Element): number {
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
 *
 * Idempotent: marks previously created by the same maker (same tag and
 * dataset identity, e.g. `mark[data-jump="e1"]`) are unwrapped first, so
 * repeated passes update the class (open `<->` closed) instead of nesting.
 * Marks from other makers (thread vs expansion, different ids) are left
 * alone. Stale marks for a quote that no longer resolves are removed and
 * 0 is returned.
 *
 * Issue #166: prefer `placeAnchorSpot` for anchors — it places by
 * recorded offsets and scopes strictly; this stays for callers with a
 * bare quote.
 */
export function markTextInElement(el: Element, quote: string, make: () => Element): number {
  if (!quote) return 0;
  const probe = make();
  unwrapOwnMarks(el, probe);
  if (typeof (el as Element).normalize === "function") (el as Element).normalize();
  const nodes = collectTextNodes(el);
  if (nodes.length === 0) return 0;
  const segments = locateQuoteSegments(nodes.map((n) => n.data), quote);
  if (!segments) return 0;
  // Wrap from the last segment backwards so earlier offsets stay valid.
  return wrapSegments(nodes, segments, make);
}

/**
 * Issue #166: place an anchor's mark inside `host` by its recorded
 * selection offsets, falling back to the nearest text match only when
 * the host's text changed (or no offsets were recorded).
 *
 * - Offsets are verified: the covered text must equal the quote
 *   (whitespace-insensitive, the toolbar's form), or the text changed and
 *   the nearest occurrence to the old offset wins.
 * - Without offsets the first occurrence wins — today's behaviour.
 * - Returns the number of marks created (0 = quote gone; the caller falls
 *   back to the comment marker / footnote chip). Like `markTextInElement`
 *   this is idempotent per maker and works on the same opaque-host model
 *   (issue #101).
 */
export function placeAnchorSpot(host: Element, spot: AnchorSpot, make: () => Element): number {
  if (!spot.quote) return 0;
  const probe = make();
  unwrapOwnMarks(host, probe);
  if (typeof (host as Element).normalize === "function") (host as Element).normalize();
  const nodes = collectTextNodes(host);
  if (nodes.length === 0) return 0;
  const texts = nodes.map((n) => n.data);
  const total = texts.reduce((s, t) => s + t.length, 0);
  const s = spot.startOffset;
  const e = spot.endOffset;
  if (
    s !== undefined &&
    e !== undefined &&
    Number.isInteger(s) &&
    Number.isInteger(e) &&
    s >= 0 &&
    s < e &&
    e <= total
  ) {
    const segs = segmentsAt(texts, s, e - s);
    if (
      segs &&
      normalizeForCompare(coveredSegmentsText(texts, segs)) === normalizeForCompare(spot.quote)
    ) {
      return wrapSegments(nodes, segs, make);
    }
    // Recorded slice no longer matches: the text changed — fall through
    // to the nearest text match.
  }
  const near = s !== undefined && Number.isInteger(s) && s >= 0 ? s : 0;
  const segs = locateNearestQuoteSegments(texts, spot.quote, near);
  if (!segs) return 0;
  return wrapSegments(nodes, segs, make);
}

/**
 * Highlight `spot` under the first `[data-top="top"]` host in `root` that
 * takes it. Returns true when highlighted (no marker needed), false when
 * the caller should fall back to the comment marker (PRD §4.8: anchor text
 * that can no longer be found).
 *
 * Issue #166: when `root` is a card/answer scope (see `anchorScope`), a
 * host counts only when it belongs to that scope — its nearest card or
 * answer ancestor must be the scope itself. A mark is drawn in its own
 * host block only, never in a nested or other card, even when block ids
 * repeat. Bare scopes (unknown card) keep today's first-match behaviour.
 */
export function highlightAnchorInRoot(
  root: ParentNode,
  top: string,
  spot: AnchorSpot,
  make: () => Element,
): boolean {
  if (!spot.quote) return false;
  let hosts: NodeListOf<Element>;
  try {
    hosts = root.querySelectorAll(`[data-top="${CSS.escape(top)}"]`);
  } catch {
    return false;
  }
  const strict = root instanceof Element && root.closest("section.card[id], [data-answer]") === root;
  for (const host of hosts) {
    if (strict && host.closest("section.card[id], [data-answer]") !== root) continue;
    if (placeAnchorSpot(host, spot, make) > 0) return true;
  }
  return false;
}

/**
 * Element to search for a `card#block` anchor's host: the card (`C-<id>`),
 * the conversation card (`B-<id>`), or one answer (`[data-answer]`, issue
 * #136) it names, so a mark never lands on the same-numbered block of
 * another card. Bare ids search all of `root`.
 */
export function anchorScope(root: ParentNode, anchorBlockId: string): ParentNode {
  const hash = anchorBlockId.indexOf("#");
  if (hash < 0) return root;
  const card = CSS.escape(anchorBlockId.slice(0, hash));
  return root.querySelector(`#C-${card}, #B-${card}, [data-answer="${card}"]`) ?? root;
}

/** Remove all anchor marks created by `make` (class `anc` by default). */
export function clearAnchorMarks(root: ParentNode, cls = "anc"): void {
  clearMarks(root, `mark.${cls}`);
}

/**
 * Unwrap every element under `root` matching `selector`, hoisting its
 * children so the text survives. Effects use this with their own narrow
 * selector (e.g. `mark.anc[data-thr]`) to drop stale highlights for
 * deleted / anchor-stale / quote-gone annotations before re-marking.
 * Callers should wrap clear + re-mark in `withPreservedSelection`.
 */
export function clearMarks(root: ParentNode, selector: string): void {
  let found: Element[] = [];
  try {
    found = [...root.querySelectorAll(selector)];
  } catch {
    return;
  }
  // Innermost first so nested leftovers from the pre-fix bug unwind cleanly.
  for (let i = found.length - 1; i >= 0; i--) unwrapElement(found[i]);
}

/**
 * Run `fn` while keeping the user's text selection and focused input
 * stable across DOM surgery that preserves text (unwrapping/re-wrapping
 * marks). Saves the selection as character offsets in `root` plus the
 * focused element (with input selection), runs `fn`, then restores.
 * Never throws: highlighting must not break the app when preservation
 * is impossible (e.g. the text itself changed).
 */
export function withPreservedSelection<T>(root: ParentNode, fn: () => T): T {
  const saved = saveSelection(root);
  try {
    return fn();
  } finally {
    restoreSelection(root, saved);
  }
}

interface SavedSelection {
  anchor: number | null;
  focus: number | null;
  active: Element | null;
  inputStart: number | null;
  inputEnd: number | null;
}

function saveSelection(root: ParentNode): SavedSelection {
  const none: SavedSelection = { anchor: null, focus: null, active: null, inputStart: null, inputEnd: null };
  try {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && active instanceof Element) {
      none.active = active;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        try {
          none.inputStart = active.selectionStart;
          none.inputEnd = active.selectionEnd;
        } catch {
          // ignore (e.g. non-text inputs)
        }
      }
    }
    const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return none;
    const anchorNode = sel.anchorNode;
    const focusNode = sel.focusNode;
    if (!anchorNode || !focusNode) return none;
    if (!root.contains(anchorNode) || !root.contains(focusNode)) return none;
    none.anchor = offsetInRoot(root, anchorNode, sel.anchorOffset);
    none.focus = offsetInRoot(root, focusNode, sel.focusOffset);
    return none;
  } catch {
    return none;
  }
}

function offsetInRoot(root: ParentNode, node: Node, offset: number): number | null {
  try {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function nodeAtOffset(root: ParentNode, offset: number): { node: Text; at: number } | null {
  try {
    // Must mirror offsetInRoot (Range.toString over all text): no `.lo`
    // skip here, or selections drift by the marker text before them.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const next = acc + text.data.length;
      if (offset <= next) return { node: text, at: Math.min(offset - acc, text.data.length) };
      acc = next;
    }
    return null;
  } catch {
    return null;
  }
}

function restoreSelection(root: ParentNode, saved: SavedSelection): void {
  try {
    if (saved.anchor !== null && saved.focus !== null) {
      const a = nodeAtOffset(root, saved.anchor);
      const f = nodeAtOffset(root, saved.focus);
      const sel = window.getSelection ? window.getSelection() : null;
      if (a && f && sel) {
        const range = document.createRange();
        range.setStart(a.node, a.at);
        range.setEnd(f.node, f.at);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    const active = saved.active;
    if (active && active.isConnected && document.activeElement !== active) {
      if (active instanceof HTMLElement && typeof active.focus === "function") {
        try {
          active.focus({ preventScroll: true } as FocusOptions);
        } catch {
          active.focus();
        }
      }
      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        saved.inputStart !== null &&
        saved.inputEnd !== null
      ) {
        try {
          active.setSelectionRange(saved.inputStart, saved.inputEnd);
        } catch {
          // ignore
        }
      }
    } else if (
      active &&
      active.isConnected &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      saved.inputStart !== null &&
      saved.inputEnd !== null &&
      document.activeElement === active
    ) {
      try {
        active.setSelectionRange(saved.inputStart, saved.inputEnd);
      } catch {
        // ignore
      }
    }
  } catch {
    // never break highlighting for selection restore
  }
}

/**
 * Issue #166: read a live selection as character offsets within `host`'s
 * plain text — the same text-node model placement uses (element text
 * nodes, `.lo` marker rows excluded). Both endpoints must be text nodes
 * of the host; anything else (element endpoints, selections outside the
 * host, collapsed ranges) returns null and the caller omits offsets, so
 * placement falls back to text match. Never throws.
 */
export function selectionOffsetsIn(
  host: Element,
  sel: Selection,
): { start: number; end: number } | null {
  try {
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const nodes = collectTextNodes(host);
    const point = (node: Node | null, offset: number): number | null => {
      if (!node || node.nodeType !== 3) return null;
      const text = node as Text;
      const idx = nodes.indexOf(text);
      if (idx < 0) return null;
      let acc = 0;
      for (let k = 0; k < idx; k++) acc += nodes[k].data.length;
      return acc + Math.min(offset, text.data.length);
    };
    const a = point(sel.anchorNode, sel.anchorOffset);
    const f = point(sel.focusNode, sel.focusOffset);
    if (a === null || f === null) return null;
    return { start: Math.min(a, f), end: Math.max(a, f) };
  } catch {
    return null;
  }
}

/**
 * Issue #166: bounded re-pass for anchors whose host text wasn't there
 * yet (the pass ran before a re-render landed). Re-checks `isSettled`
 * and re-runs `repass` up to `attempts` times, `delayMs` apart, then
 * gives up quietly — the next snapshot/route change passes again anyway.
 * Returns a cleanup that cancels the pending retry (call it when the
 * pass re-runs or unmounts). Never throws.
 */
export function repassUntilSettled(
  isSettled: () => boolean,
  repass: () => void,
  attempts = 3,
  delayMs = 250,
): () => void {
  let remaining = attempts;
  let timer = 0;
  const tick = (): void => {
    timer = 0;
    let done = true;
    try {
      done = isSettled();
    } catch {
      done = true;
    }
    if (done) return;
    try {
      repass();
    } catch {
      // A failing re-pass must not cancel the remaining attempts.
    }
    remaining -= 1;
    if (remaining <= 0) return;
    timer = window.setTimeout(tick, delayMs);
  };
  timer = window.setTimeout(tick, delayMs);
  return () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
}

/** True when `el` was created by the same maker as `probe`. */function isOwnMark(el: Element, probe: Element): boolean {
  if (el.tagName !== probe.tagName) return false;
  const a = (probe as HTMLElement).dataset ?? {};
  const b = (el as HTMLElement).dataset ?? {};
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length === 0 && kb.length === 0) {
    // Makers without datasets (none in the app today): match on class.
    return el.className === probe.className;
  }
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (b as Record<string, string>)[k] === (a as Record<string, string>)[k]);
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  try {
    parent.normalize();
  } catch {
    // ignore (detached parents)
  }
}

/** Unwrap previous marks from the same maker inside `el` (innermost first). */
function unwrapOwnMarks(el: Element, probe: Element): void {
  let all: Element[] = [];
  try {
    all = [...el.querySelectorAll("*")];
  } catch {
    return;
  }
  for (let i = all.length - 1; i >= 0; i--) {
    const candidate = all[i];
    // Still part of this host (an outer unwrap above may have moved it,
    // but it stays inside `el`; a removed node has no parent).
    if (!candidate.parentNode || !el.contains(candidate)) continue;
    // Only unwrap marks inside this host (querySelectorAll is already
    // scoped; contains guards nodes moved by an outer unwrap).
    if (isOwnMark(candidate, probe)) unwrapElement(candidate);
  }
}
