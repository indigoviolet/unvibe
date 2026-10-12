/**
 * Walk every live `Block[]` list in a review snapshot (issue #71).
 *
 * Diagram blocks can be stored anywhere the data model holds blocks, not
 * only in page cards: Explain expansions live in
 * `annotations[].expansion.blocks`, and second-opinion reasoning carries
 * its own `blocks`. The diagrams route searches through this module so a
 * new container cannot be missed silently — add its list here.
 *
 * Live containers (rendered by the web, addressable by hash):
 * - `pages[].cards[].blocks` (root / concept / finding / opened-expansion
 *   pages; go-deeper fills land here as ordinary cards)
 * - `pages[].cards[].secondOpinions[].blocks`
 * - `annotations[].expansion.blocks`
 * - `annotations[].expansion.secondOpinions[].blocks`
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
 * blocks, card second opinions, expansion blocks, expansion second
 * opinions). Recursion into asides happens in {@link walkBlocks}, not
 * here.
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
    const exp = ann.expansion;
    if (!exp) continue;
    if (exp.blocks) lists.push(exp.blocks);
    for (const so of exp.secondOpinions ?? []) {
      if (so.blocks) lists.push(so.blocks);
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
