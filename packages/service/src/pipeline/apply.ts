/**
 * Apply parsed agent replies to the snapshot (M3 pipeline).
 *
 * Every helper is pure over blocks + trailing JSON except for ID
 * assignment, which follows the recordings' conventions so demo output
 * matches `fixtures/urllib3-5020/snapshot.json`:
 * - reader `cardIds` → problem/central card ids;
 * - critic `cardIds` → finding card ids, replay key → finding page id;
 * - go-deeper `cardId` → placeholder card id;
 * - concept `slug` → `c-<slug>` page id.
 */
import type { Annotation, Block, Card, Page } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";

function mkCard(id: string, pageId: string, title: string | null, blocks: Block[]): Card {
  return {
    id,
    pageId,
    title,
    level: "standard",
    collapsed: false,
    revision: 1,
    blocks,
    undoStack: [],
  };
}

export interface ReaderApply {
  cards: { id: string; title: string | null; blocks: Block[] }[];
  pendingCards: { id: string; label: string; why: string }[];
  concepts: { slug: string; title: string; summary: string }[];
  /**
   * Issue #169: the reader's raw plotline payload (validated against the
   * review's hunk IDs by the caller — unknown IDs dropped, first
   * plotline wins a hunk claimed twice).
   */
  plotlines: { id?: string; name?: string; description?: string; buildsOn?: string; hunks?: string[] }[];
}

/**
 * Root card id for the reader's card at `index`. Streamed cards and the
 * final apply must agree on this, or the final apply stores each streamed
 * card a second time (#28).
 */
export function readerCardId(index: number, cardIds: string[] = []): string {
  // Issue #198: the reader's settled order is problem, central idea(s),
  // "How it's built up", "Decisions and alternatives".
  return cardIds[index] ?? (index === 0 ? "problem" : index === 1 ? "central" : index === 2 ? "buildup" : index === 3 ? "decisions" : `reader-${index}`);
}

/** True for ids `readerCardId` hands out when the reply names none. */
export function isDefaultReaderCardId(id: string): boolean {
  return id === "problem" || id === "central" || id === "buildup" || id === "decisions" || /^reader-\d+$/.test(id);
}

/**
 * Drop text the agent wrote before its first `## ` card ("I'll start by
 * reading…"). Only when both cards follow with titles: an untitled first
 * section followed by a single titled card is more likely the problem card
 * missing its heading, and is kept.
 */
export function dropReaderPreamble<T extends { title: string | null }>(cards: T[]): T[] {
  if (cards.length >= 3 && cards[0].title === null && cards[1].title !== null && cards[2].title !== null) {
    return cards.slice(1);
  }
  return cards;
}

/**
 * Split a finalized flat block list back across parsed cards by their
 * original block counts (#145: the reader finalizes inline diagrams over
 * the flattened cards so a bad diagram costs one shared repair turn, then
 * restores the per-card split for `readerApply`). Finalize maps blocks 1:1
 * except a repair reply's extra diagrams, which append to the last card.
 */
export function splitFinalizedBlocks<T extends { blocks: Block[] }>(cards: T[], blocks: Block[]): T[] {
  let i = 0;
  return cards.map((c, idx) => {
    const take = blocks.slice(i, i + c.blocks.length);
    i += c.blocks.length;
    const rest = idx === cards.length - 1 ? blocks.slice(i) : [];
    i += rest.length;
    return { ...c, blocks: [...take, ...rest] };
  });
}

/** Split a reader reply into root cards + placeholders + concepts. */
export function readerApply(
  parsedCards: { title: string | null; blocks: Block[] }[],
  data: Record<string, unknown> | null,
): ReaderApply {
  const cardIds = (data?.["cardIds"] as string[] | undefined) ?? [];
  const cards = dropReaderPreamble(parsedCards).map((c, i) => ({
    id: readerCardId(i, cardIds),
    title: c.title,
    blocks: c.blocks,
  }));
  const pendingCards = ((data?.["pendingCards"] as { id?: string; label?: string; why?: string }[] | undefined) ?? []).map(
    (p) => ({
      id: p.id ?? `g-${Math.random().toString(36).slice(2, 8)}`,
      label: p.label ?? "(untitled)",
      why: p.why ?? "",
    }),
  );
  const concepts = ((data?.["concepts"] as { slug?: string; title?: string; summary?: string }[] | undefined) ?? []).map(
    (c) => ({
      slug: c.slug ?? "",
      title: c.title ?? c.slug ?? "",
      summary: c.summary ?? "",
    }),
  ).filter((c) => c.slug);
  const plotlines = (
    (data?.["plotlines"] as { id?: string; name?: string; description?: string; buildsOn?: string; hunks?: string[] }[] | undefined) ?? []
  ).map((p) => ({
    ...(p.id !== undefined ? { id: p.id } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.buildsOn !== undefined ? { buildsOn: p.buildsOn } : {}),
    ...(p.hunks !== undefined ? { hunks: p.hunks } : {}),
  }));
  return { cards, pendingCards, concepts, plotlines };
}

export interface CriticApply {
  pageId: string;
  title: string;
  confidence: string;
  summary: string;
  cards: { id: string; title: string | null; blocks: Block[] }[];
  suggestedComment?: { text: string; diff: string };
}

/** One critic reply → one finding page + optional suggested comment. */
export function criticApply(
  parsedCards: { title: string | null; blocks: Block[] }[],
  data: Record<string, unknown> | null,
  fallbackPageId: string,
): CriticApply {
  const finding = (data?.["finding"] as { confidence?: string; summary?: string; suggestedComment?: { text?: string; diff?: string } } | undefined) ?? {};
  const cardIds = (data?.["cardIds"] as string[] | undefined) ?? [];
  const title = (data?.["title"] as string | undefined) ?? parsedCards[0]?.title ?? "Finding";
  const suggested =
    finding.suggestedComment?.text && finding.suggestedComment?.diff
      ? { text: finding.suggestedComment.text, diff: finding.suggestedComment.diff }
      : undefined;
  return {
    pageId: fallbackPageId,
    title,
    confidence: finding.confidence ?? "medium",
    summary: finding.summary ?? "",
    cards: parsedCards.map((c, i) => ({
      id: cardIds[i] ?? `${fallbackPageId}-${i}`,
      title: c.title,
      blocks: c.blocks,
    })),
    ...(suggested ? { suggestedComment: suggested } : {}),
  };
}

/** Build a suggested-comment thread annotation from a `diff:` anchor. */
export function suggestedAnnotation(
  id: string,
  text: string,
  diffTarget: string,
  version: number,
  aliases: Record<string, string>,
  lineTextOf: (fileKey: string, line: number) => string | null,
): Annotation | null {
  const parsed = parseId(diffTarget);
  if (parsed?.kind !== "diff") return null;
  const fileKey = aliases[parsed.fileKey] ?? parsed.fileKey;
  const line = parsed.start;
  const lineText = lineTextOf(fileKey, line) ?? "";
  // Quoted text: first identifier-like token on the line (matches the
  // fixture's `_OBSOLETE_FOLD_RE` style without hard-coding it).
  const m = lineText.match(/[A-Za-z_][A-Za-z0-9_]+/);
  const quotedText = m ? m[0] : lineText.slice(0, 40);
  return {
    id,
    type: "comment",
    anchor: {
      host: { kind: "diff-line", fileKey, line },
      quotedText,
      prefix: "",
      suffix: "",
      position: 0,
      version,
    },
    open: true,
    pinned: false,
    messages: [{ who: "ai", suggested: true, text }],
    post: false,
  };
}

export function conceptPage(id: string, title: string, blocks: Block[], saved = true): Page {
  return {
    id,
    kind: "concept",
    title,
    saved,
    parent: "root",
    cards: [mkCard(`cc-${id.replace(/^c-/, "")}`, id, null, blocks)],
  };
}

export function findingPage(
  pageId: string,
  title: string,
  confidence: string,
  summary: string,
  cards: { id: string; title: string | null; blocks: Block[] }[],
): Page {
  return {
    id: pageId,
    kind: "finding",
    title,
    saved: false,
    parent: "root",
    confidence,
    summary,
    cards: cards.map((c) => mkCard(c.id, pageId, c.title, c.blocks)),
  };
}
