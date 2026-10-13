/**
 * Walk every live `Block[]` list in a review snapshot (issue #71).
 *
 * Diagram blocks can be stored anywhere the data model holds blocks, not
 * only in page cards: conversation answers live in
 * `annotations[].turns[].blocks`, and second-opinion reasoning carries
 * its own `blocks`. The diagrams route searches through this module so a
 * new container cannot be missed silently — add its list here.
 *
 * Live containers (rendered by the web, addressable by hash):
 * - `pages[].cards[].blocks` (root / concept / finding / opened-expansion
 *   pages; go-deeper fills land here as ordinary cards)
 * - `pages[].cards[].secondOpinions[].blocks`
 * - `annotations[].turns[].blocks` (issue #136: every turn, so a diagram
 *   in a follow-up answer renders like any other)
 * - `annotations[].turns[].secondOpinions[].blocks`
 * - `aside.inner`, recursively, inside any of the above
 *
 * Deliberately excluded:
 * - `CardSnapshot` undo stacks (stale revisions, never rendered; restoring
 *   one makes it live again and therefore findable)
 * - `DepthText` variants (HTML strings, not blocks)
 * - thread `ChatMessage` HTML (ask replies carry the raw source as
 *   `<pre class="d2">`, not a `DiagramBlock`; separate case)
 *
 * Pure helpers only (no Node/DOM).
 */
import type { Annotation, Block, DiagramBlock, Page } from "../entities.js";
import { canonicalizeD2Source } from "./d2.js";

/** The snapshot slice the walker needs (structural, not the full type). */
export interface BlockSnapshot {
  pages: Page[];
  annotations: Annotation[];
}

/**
 * Every live `Block[]` list in the snapshot, in a fixed order (card
 * blocks, card second opinions, turn blocks, turn second opinions).
 * Recursion into asides happens in {@link walkBlocks}, not here.
 */
export function liveBlockLists(snapshot: BlockSnapshot): Block[][] {
  const lists: Block[][] = [];
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.blocks) lists.push(card.blocks);
      for (const so of card.secondOpinions ?? []) {
        if (so.blocks) lists.push(so.blocks);
      }
    }
  }
  for (const ann of snapshot.annotations ?? []) {
    for (const turn of ann.turns ?? []) {
      if (turn.blocks) lists.push(turn.blocks);
      for (const so of turn.secondOpinions ?? []) {
        if (so.blocks) lists.push(so.blocks);
      }
    }
  }
  return lists;
}

/** Collect every diagram block in a block list, descending into asides. */
function walkBlocks(blocks: Block[], out: DiagramBlock[]): void {
  for (const b of blocks ?? []) {
    if (!b) continue;
    if (b.type === "diagram") {
      out.push(b);
    } else if (b.type === "aside") {
      walkBlocks(b.inner ?? [], out);
    }
  }
}

/** Every live diagram block in the snapshot. */
export function allDiagramBlocks(snapshot: BlockSnapshot): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  for (const list of liveBlockLists(snapshot)) walkBlocks(list, out);
  return out;
}

/** First live diagram block with this render hash, or null. */
export function findDiagramByHash(snapshot: BlockSnapshot, hash: string): DiagramBlock | null {
  return allDiagramBlocks(snapshot).find((d) => d.render?.hash === hash) ?? null;
}

/** First live diagram block with this (canonicalised) source, or null. */
export function findDiagramBySource(snapshot: BlockSnapshot, source: string): DiagramBlock | null {
  const canon = canonicalizeD2Source(source);
  for (const d of allDiagramBlocks(snapshot)) {
    if (canonicalizeD2Source(d.source) === canon) return d;
  }
  return null;
}

/**
 * Suffix for the second, third, … occurrence of a repeated block ID.
 * First occurrence keeps its ID, so anchors made before a duplicate
 * existed keep pointing at the same block.
 */
function nextSuffixedId(used: Set<string>, base: string): string {
  let n = 2;
  let id = `${base}-c${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${base}-c${n}`;
  }
  return id;
}

/**
 * An ID based on `base` that no top-level block in `blocks` uses (#116).
 * Returns `base` itself when it is free, else `base-c2`, `base-c3`, ….
 */
export function freshBlockId(blocks: Block[], base: string): string {
  const used = new Set(blocks.map((b) => b.id));
  if (!used.has(base)) return base;
  return nextSuffixedId(used, base);
}

/**
 * Make top-level block IDs unique within one stored body (#116).
 *
 * `parseCards` numbers blocks `b1, b2, …` per card, so flattening a
 * multi-card reply (`cards.flatMap((c) => c.blocks)`) into one body — an
 * explanation, a follow-up answer, second-opinion reasoning — repeats
 * IDs. Two blocks sharing an ID match one anchor, and the annotation
 * renders under both. Run once when the body is first stored: the first
 * occurrence keeps its ID, later ones take `-c2`, `-c3`, … (aside inner
 * IDs, `<parent>-bN`, move with their renamed parent). Rewrites preserve
 * IDs, so anchors hosted on a block still find it afterwards; a rewrite
 * that removes the block takes the existing stale-anchor footnote path.
 */
export function dedupeBlockIds(blocks: Block[]): Block[] {
  const used = new Set<string>();
  return blocks.map((b) => {
    if (!used.has(b.id)) {
      used.add(b.id);
      return b;
    }
    const id = nextSuffixedId(used, b.id);
    used.add(id);
    if (b.type === "aside") {
      const prefix = `${b.id}-`;
      return {
        ...b,
        id,
        inner: b.inner.map((ib) =>
          ib.id.startsWith(prefix) ? { ...ib, id: `${id}-${ib.id.slice(prefix.length)}` } : ib,
        ),
      };
    }
    return { ...b, id };
  });
}
