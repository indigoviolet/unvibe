/**
 * Card targets + pure card mutations (issue #273).
 *
 * A "card" for interaction purposes is either a `Page` card or one reply of a thread (`Thread.replies`, each with its own
 * `ans_…` id). Every helper below resolves both, so depth / examples /
 * diagram / undo / second opinion work on answers exactly like on cards
 * (PRD §4.4). All mutations run inside `ReviewStore.mutate` in the action
 * modules; this file only builds the draft edits.
 */
import type { WritableDraft } from "immer";
import type {
  Thread,
  AsideBlock,
  Block,
  Card,
  CardSnapshot,
  DepthLevel,
  DiagramBlock,
  ReviewSnapshot,
  Reply,
} from "@unvibe/shared";
import { freshBlockId } from "@unvibe/shared";

export type CardTarget =
  | { kind: "page-card"; pageId: string; card: Card }
  | { kind: "answer"; annotation: Thread; turn: Reply };

const ORDER: DepthLevel[] = ["simple", "standard", "deep"];

/** Find a page card or a conversation answer by id. */
export function findCardTarget(snapshot: ReviewSnapshot, cardId: string): CardTarget | null {
  for (const page of snapshot.pages ?? []) {
    const card = (page.cards ?? []).find((c) => c.id === cardId);
    if (card) return { kind: "page-card", pageId: page.id, card };
  }
  for (const annotation of snapshot.annotations ?? []) {
    const turn = (annotation.replies ?? []).find((t) => t.id === cardId);
    if (turn) return { kind: "answer", annotation, turn };
  }
  return null;
}

/** Same, on an immer draft (returns draft proxies). */
export function findCardTargetInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  cardId: string,
): CardTarget | null {
  for (const page of draft.pages ?? []) {
    const card = (page.cards ?? []).find((c) => c.id === cardId);
    if (card) return { kind: "page-card", pageId: page.id, card: card as Card };
  }
  for (const annotation of draft.annotations ?? []) {
    const ann = annotation as unknown as Thread;
    const turn = (ann.replies ?? []).find((t) => t.id === cardId);
    if (turn) return { kind: "answer", annotation: ann, turn: turn as Reply };
  }
  return null;
}

/** The conversation card holding an answer, or null. */
export function conversationForAnswer(snapshot: ReviewSnapshot, answerId: string): Thread | null {
  for (const annotation of snapshot.annotations ?? []) {
    if ((annotation.replies ?? []).some((t) => t.id === answerId)) return annotation;
  }
  return null;
}

/**
 * Copy a promoted answer's current content onto its page card (issue
 * #152). A conversation opened as a page mid-fill keeps its turns on the
 * link annotation as the fill's state owner; the page card is the visible
 * copy. Call after every turn mutation so the two never diverge. No-op
 * when the answer is not a promoted turn, or its page card is gone.
 */
export function mirrorPromotedAnswer(
  draft: WritableDraft<ReviewSnapshot>,
  answerId: string,
): void {
  for (const annotation of draft.annotations as unknown as Thread[]) {
    const mapping = (annotation.promotedReplies ?? []).find((m) => m.replyId === answerId);
    if (!mapping) continue;
    const turn = (annotation.replies ?? []).find((t) => t.id === answerId);
    if (!turn) continue;
    for (const page of draft.pages ?? []) {
      const card = (page.cards ?? []).find((c) => c.id === mapping.cardId);
      if (!card) continue;
      card.blocks = structuredCloneBlocks(turn.blocks);
      card.level = turn.level;
      card.revision = turn.revision;
      card.undoStack = JSON.parse(JSON.stringify(turn.undoStack)) as Card["undoStack"];
      card.secondOpinions = turn.secondOpinions
        ? (JSON.parse(JSON.stringify(turn.secondOpinions)) as Card["secondOpinions"])
        : undefined;
      return;
    }
  }
}

export function targetLevel(target: CardTarget): DepthLevel {
  return target.kind === "page-card" ? target.card.level : target.turn.level;
}

export function targetBlocks(target: CardTarget): Block[] {
  return target.kind === "page-card" ? target.card.blocks : target.turn.blocks;
}

export function targetRevision(target: CardTarget): number {
  return target.kind === "page-card" ? target.card.revision : target.turn.revision;
}

/** Push the current blocks+level onto the undo stack (no redo, PRD §4.4). */
export function pushUndo(target: CardTarget, blocks: Block[], level: DepthLevel): void {  const entry: CardSnapshot = { blocks: structuredCloneBlocks(blocks), level };
  if (target.kind === "page-card") {
    target.card.undoStack.push(entry);
  } else {
    target.turn.undoStack.push(entry);
  }
}

function structuredCloneBlocks(blocks: Block[]): Block[] {
  return JSON.parse(JSON.stringify(blocks)) as Block[];
}

/** Set blocks + level + bump revision on the target. */
export function setTargetContent(target: CardTarget, blocks: Block[], level: DepthLevel): void {
  if (target.kind === "page-card") {
    target.card.blocks = blocks;
    target.card.level = level;
    target.card.revision += 1;
  } else {
    target.turn.blocks = blocks;
    target.turn.level = level;
    target.turn.revision += 1;
  }
}

/**
 * Pop the undo stack: restore the last blocks+level, drop everything
 * after it (no redo, no history trail). Returns false when empty.
 *
 * Comments and nested cards attached to the card survive undo:
 * annotations live outside cards (re-attached to their blocks by id, as
 * the prototype's `setContent` does), so restoring blocks never orphans
 * them. Block ids are stable across rewrites, so anchors keep resolving.
 */
export function applyUndo(target: CardTarget): boolean {
  const stack = target.kind === "page-card" ? target.card.undoStack : target.turn.undoStack;
  const prev = stack.pop();
  if (!prev) return false;
  if (target.kind === "page-card") {
    target.card.blocks = prev.blocks;
    target.card.level = prev.level;
    target.card.revision += 1;
  } else {
    target.turn.blocks = prev.blocks;
    target.turn.level = prev.level;
    target.turn.revision += 1;
  }
  return true;
}

/** Step one level simpler/deeper; null when already at that end. */
export function stepLevel(level: DepthLevel, direction: "simpler" | "deeper"): DepthLevel | null {
  const i = ORDER.indexOf(level);
  const ni = i + (direction === "simpler" ? -1 : 1);
  if (ni < 0 || ni >= ORDER.length) return null;
  return ORDER[ni];
}

/**
 * True when every paragraph already carries text for `level` (stored per
 * block per level; switching back is instant and costs no agent call).
 */
export function hasLevelText(blocks: Block[], level: DepthLevel): boolean {
  let anyParagraph = false;
  for (const b of blocks) {
    if (b.type !== "paragraph") continue;
    anyParagraph = true;
    if (b.text[level] === undefined) return false;
  }
  // Cards without paragraphs (diagram-only etc.) have nothing to rewrite.
  return anyParagraph;
}

/** Paragraph ids in order (for example/diagram placement). */
export function paragraphIds(blocks: Block[]): string[] {
  return blocks.filter((b) => b.type === "paragraph").map((b) => b.id);
}

/** Normalised key for example-dedupe (inner text, whitespace-folded). */
function exampleKey(inner: Block[]): string {
  // IDs excluded (#116): inserted asides are restamped with fresh IDs, so
  // the same example compares equal before and after insertion.
  return JSON.stringify(
    inner,
    (k, v) => (k === "id" ? undefined : v),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/** Keys of the Example asides already on the card. */
export function existingExampleKeys(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type === "aside" && b.kind === "Example") out.add(exampleKey(b.inner));
  }
  return out;
}

/**
 * Insert new Example asides after the paragraphs they relate to, never
 * duplicating one already there. The agent returns `::: example`
 * containers (parsed as `aside` kind Example); each is placed after the
 * next paragraph without an example, in order. Unknown placement falls
 * back to appending after the last paragraph.
 */
export function insertExamples(blocks: Block[], fresh: Block[]): { blocks: Block[]; added: number } {
  const incoming = fresh.filter((b) => b.type === "aside" && (b as AsideBlock).kind === "Example") as AsideBlock[];
  if (incoming.length === 0) return { blocks, added: 0 };
  const seen = existingExampleKeys(blocks);
  const out = [...blocks];
  let added = 0;
  // Paragraph indexes that do not yet have an example directly after them.
  const openSlots: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i].type !== "paragraph") continue;
    const next = out[i + 1];
    if (next?.type === "aside" && (next as AsideBlock).kind === "Example") continue;
    openSlots.push(i);
  }
  let slot = 0;
  for (const aside of incoming) {
    const key = exampleKey(aside.inner);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = slot < openSlots.length ? openSlots[slot] + 1 + added : out.length;
    // `added` shifts later indexes by the number already inserted.
    const insertAt = Math.min(at, out.length);
    // Fresh ID within this body (#116): the timestamp base collides only
    // across same-millisecond inserts, but the used-set makes it exact.
    const id = freshBlockId(out, `b-ex-${Date.now().toString(36)}-${added}`);
    out.splice(insertAt, 0, withFreshAsideId(aside, id));
    added++;
    slot++;
  }
  return { blocks: out, added };
}

/** Assign a fresh top-level ID, moving aside inner IDs with their parent. */
export function withFreshAsideId<T extends Block>(block: T, id: string): T {
  if (block.type !== "aside" || block.id === id) return { ...block, id };
  const prefix = `${block.id}-`;
  return {
    ...block,
    id,
    inner: block.inner.map((ib) =>
      ib.id.startsWith(prefix) ? { ...ib, id: `${id}-${ib.id.slice(prefix.length)}` } : ib,
    ),
  };
}

function diagramKey(b: DiagramBlock | AsideBlock): string {
  if ((b as DiagramBlock).type === "diagram") {
    const d = b as DiagramBlock;
    return `d2:${(d.source ?? "").replace(/\s+/g, " ").trim().slice(0, 2000)}`;
  }
  return exampleKey((b as AsideBlock).inner);
}

/** True when the card already carries an equivalent diagram. */
export function hasDiagram(blocks: Block[], candidate: Block): boolean {
  const key =
    candidate.type === "diagram"
      ? diagramKey(candidate as DiagramBlock)
      : candidate.type === "aside"
        ? diagramKey(candidate as AsideBlock)
        : null;
  if (!key) return false;
  for (const b of blocks) {
    if (b.type === "diagram" && diagramKey(b) === key) return true;
    if (b.type === "aside" && (b as AsideBlock).kind === "Diagram" && diagramKey(b as AsideBlock) === key) {
      return true;
    }
  }
  return false;
}

/**
 * Insert diagram block(s) after the paragraphs they relate to, never
 * duplicating one already there. Returns the new blocks + added count.
 */
export function insertDiagrams(blocks: Block[], fresh: Block[]): { blocks: Block[]; added: number } {
  const incoming = fresh.filter((b) => b.type === "diagram" || (b.type === "aside" && (b as AsideBlock).kind === "Diagram"));
  if (incoming.length === 0) return { blocks, added: 0 };
  for (const c of incoming) {
    if (hasDiagram(blocks, c)) return { blocks, added: 0 };
  }
  const out = [...blocks];
  // Place after the last paragraph (the walkthrough relates to the whole
  // card); the agent's caption/prose blocks follow the diagram.
  let at = out.length;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].type === "paragraph") {
      at = i + 1;
      break;
    }
  }
  // Fresh IDs within this body (#116): the timestamp base collides only
  // across same-millisecond inserts, but the used-set makes it exact.
  const stamped: Block[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const id = freshBlockId([...out, ...stamped], `b-dg-${Date.now().toString(36)}-${i}`);
    stamped.push(withFreshAsideId(incoming[i], id));
  }
  out.splice(at, 0, ...stamped);
  return { blocks: out, added: stamped.length };
}

/** True when the card already has an Underlying-principle block. */
export function hasPrinciple(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "aside" && (b as AsideBlock).kind === "Underlying principle");
}

/**
 * Merge a depth reply into the card: per-paragraph `text[level]` slots
 * are filled from the reply's paragraphs in order (stored per block per
 * level and kept once made). Blocks that are not paragraphs (examples,
 * diagrams, follow-ups) are left untouched. Returns the merged blocks.
 */
export function mergeDepthText(current: Block[], reply: Block[], level: DepthLevel): Block[] {
  const replyParas = reply.filter((b) => b.type === "paragraph");
  if (replyParas.length === 0) return current;
  let ri = 0;
  return current.map((b) => {
    if (b.type !== "paragraph") return b;
    const rp = replyParas[Math.min(ri++, replyParas.length - 1)];
    if (rp.type !== "paragraph") return b;
    const incoming = rp.text[level] ?? rp.text.standard;
    if (!incoming || incoming === b.text[level]) return b;
    return { ...b, text: { ...b.text, [level]: incoming } };
  });
}

/**
 * After a depth rewrite, check every annotation anchored on this card's
 * blocks: when the anchor quote is no longer a substring of the host
 * block's *currently shown* text, the annotation stays attached but
 * carries `anchorStale` so the UI shows the footnote chip (PRD §4.7).
 *
 * Paragraphs store per-level text; the renderer shows `depthText`
 * (`simple ?? standard`, `deep ?? standard` — see
 * `packages/web/src/guide/guideUtils.ts`). Checking every level joined
 * would count a quote that only exists in a hidden level as found, so
 * check the card's current level with the same fallback.
 */
function visibleParagraphText(text: { simple?: string; standard: string; deep?: string }, level: DepthLevel): string {
  if (level === "simple") return text.simple ?? text.standard;
  if (level === "deep") return text.deep ?? text.standard;
  return text.standard;
}

export function markStaleAnchors(draft: WritableDraft<ReviewSnapshot>, cardId: string): string[] {
  const stale: string[] = [];
  const hostText = new Map<string, string>();
  const collect = (blocks: Block[] | undefined, level: DepthLevel): void => {
    for (const b of blocks ?? []) {
      if (b.type === "paragraph") {
        hostText.set(b.id, visibleParagraphText(b.text, level));
      } else if (b.type === "aside") {
        hostText.set(b.id, JSON.stringify(b.inner).slice(0, 4000));
      } else {
        hostText.set(b.id, JSON.stringify(b).slice(0, 4000));
      }
    }
  };
  for (const page of draft.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id === cardId) collect(card.blocks as Block[], card.level);
    }
  }
  for (const ann of draft.annotations as unknown as Thread[]) {
    for (const turn of ann.replies ?? []) {
      if (turn.id === cardId) collect(turn.blocks, turn.level);
    }
  }
  for (const ann of (draft.annotations ?? []) as unknown as Thread[]) {
    const host = ann.anchor?.host;
    if (!host || host.kind !== "block") continue;
    const rawId = host.blockId;
    const shortId = rawId.includes("#") ? rawId.split("#").pop()! : rawId.includes(":") ? rawId.split(":").pop()! : rawId;
    if (!hostText.has(shortId) && !hostText.has(rawId)) continue;
    const text = hostText.get(shortId) ?? hostText.get(rawId) ?? "";
    const quote = ann.anchor.quotedText ?? "";
    const found = quote !== "" && text.includes(quote);
    if (!found && !ann.anchorStale) {
      ann.anchorStale = true;
      stale.push(ann.id);
    } else if (found && ann.anchorStale) {
      delete ann.anchorStale;
    }
  }
  return stale;
}
