/**
 * Card targets + pure card mutations (M4).
 *
 * A "card" for interaction purposes is either a `Page` card or an
 * expansion annotation's embedded card (`Annotation.expansion`). Every
 * helper below resolves both, so depth / examples / diagram / undo /
 * read / collapse work on expansions exactly like on cards (PRD §4.4,
 * §4.7). All mutations run inside `ReviewStore.mutate` in the action
 * modules; this file only builds the draft edits.
 */
import type { WritableDraft } from "immer";
import type {
  Annotation,
  AsideBlock,
  Block,
  Card,
  CardSnapshot,
  DepthLevel,
  DiagramBlock,
  ReviewSnapshot,
} from "@unvibe/shared";

export type CardTarget =
  | { kind: "page-card"; pageId: string; card: Card }
  | { kind: "expansion"; annotation: Annotation };

const ORDER: DepthLevel[] = ["simple", "standard", "deep"];

/** Find a page card or an expansion annotation by id. */
export function findCardTarget(snapshot: ReviewSnapshot, cardId: string): CardTarget | null {
  for (const page of snapshot.pages ?? []) {
    const card = (page.cards ?? []).find((c) => c.id === cardId);
    if (card) return { kind: "page-card", pageId: page.id, card };
  }
  const annotation = (snapshot.annotations ?? []).find((a) => a.id === cardId);
  if (annotation?.type === "expansion" && annotation.expansion) {
    return { kind: "expansion", annotation };
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
  const annotation = (draft.annotations ?? []).find((a) => a.id === cardId);
  const ann = annotation as unknown as Annotation | undefined;
  if (ann?.type === "expansion" && ann.expansion) {
    return { kind: "expansion", annotation: ann };
  }
  return null;
}

export function targetLevel(target: CardTarget): DepthLevel {
  return target.kind === "page-card" ? target.card.level : (target.annotation.expansion?.level ?? "standard");
}

export function targetBlocks(target: CardTarget): Block[] {
  return target.kind === "page-card" ? target.card.blocks : (target.annotation.expansion?.blocks ?? []);
}

export function targetRevision(target: CardTarget): number {
  return target.kind === "page-card" ? target.card.revision : (target.annotation.expansion?.revision ?? 1);
}

/** Push the current blocks+level onto the undo stack (no redo, PRD §4.4). */
export function pushUndo(target: CardTarget, blocks: Block[], level: DepthLevel): void {
  const entry: CardSnapshot = { blocks: structuredCloneBlocks(blocks), level };
  if (target.kind === "page-card") {
    target.card.undoStack.push(entry);
  } else {
    target.annotation.expansion!.undoStack.push(entry);
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
    const exp = target.annotation.expansion!;
    exp.blocks = blocks;
    exp.level = level;
    exp.revision += 1;
  }
}

/**
 * Pop the undo stack: restore the last blocks+level, drop everything
 * after it (no redo, no history trail). Returns false when empty.
 *
 * Comments and expansions attached to the card survive undo: annotations
 * live outside cards (re-attached to their blocks by id, as the
 * prototype's `setContent` does), so restoring blocks never orphans
 * them. Block ids are stable across rewrites, so anchors keep resolving.
 */
export function applyUndo(target: CardTarget): boolean {
  const stack =
    target.kind === "page-card" ? target.card.undoStack : (target.annotation.expansion?.undoStack ?? []);
  const prev = stack.pop();
  if (!prev) return false;
  if (target.kind === "page-card") {
    target.card.blocks = prev.blocks;
    target.card.level = prev.level;
    target.card.revision += 1;
  } else {
    const exp = target.annotation.expansion!;
    exp.blocks = prev.blocks;
    exp.level = prev.level;
    exp.revision += 1;
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
  return JSON.stringify(inner)
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
    out.splice(insertAt, 0, { ...aside, id: `b-ex-${Date.now().toString(36)}-${added}` });
    added++;
    slot++;
  }
  return { blocks: out, added };
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
  const stamped = incoming.map((b, i) => ({ ...b, id: `b-dg-${Date.now().toString(36)}-${i}` }));
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
 * block text, the annotation stays attached but carries `anchorStale`
 * so the UI shows the collapsed-card fallback (PRD §4.7).
 */
export function markStaleAnchors(draft: WritableDraft<ReviewSnapshot>, cardId: string): string[] {
  const stale: string[] = [];
  const hostText = new Map<string, string>();
  const collect = (blocks: Block[] | undefined): void => {
    for (const b of blocks ?? []) {
      if (b.type === "paragraph") {
        hostText.set(b.id, Object.values(b.text).join("\n"));
      } else if (b.type === "aside") {
        hostText.set(b.id, JSON.stringify(b.inner).slice(0, 4000));
      } else {
        hostText.set(b.id, JSON.stringify(b).slice(0, 4000));
      }
    }
  };
  for (const page of draft.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id === cardId) collect(card.blocks as Block[]);
    }
  }
  const exp = (draft.annotations as unknown as Annotation[]).find((a) => a.id === cardId);
  if (exp?.type === "expansion" && exp.expansion) collect(exp.expansion.blocks);
  for (const ann of (draft.annotations ?? []) as unknown as Annotation[]) {
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
      if (ann.type === "expansion" && ann.expansion) ann.expansion.anchorStale = true;
      stale.push(ann.id);
    } else if (found && ann.anchorStale) {
      delete ann.anchorStale;
      if (ann.type === "expansion" && ann.expansion) delete ann.expansion.anchorStale;
    }
  }
  return stale;
}
