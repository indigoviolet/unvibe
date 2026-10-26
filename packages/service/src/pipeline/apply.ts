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
  /**
   * Issue #169: the reader's raw plotline payload (validated against the
   * review's hunk IDs by the caller — unknown IDs dropped, first
   * plotline wins a hunk claimed twice). Kept only when requested (see
   * `requestedReaderFields`).
   */
  plotlines: { id?: string; name?: string; description?: string; buildsOn?: string; hunks?: string[] }[];
  /**
   * Issue #252: the reader's raw glossary payload (validated by the
   * caller — shape, exact-name dedupe, citation grammar, then existence
   * via the lookup like any other citation). Kept only when requested
   * (see `requestedReaderFields`).
   */
  glossary: { name?: string; definition?: string; citation?: string }[];
}

/**
 * Optional trailing-JSON fields the reader-result parser reads. A reply
 * carrying any other key is ignored for that key (unknown fields were
 * always ignored by the split layer; these are the known ones).
 */
export const READER_RESULT_FIELDS = ["cardIds", "pendingCards", "plotlines", "glossary"] as const;

/**
 * Issue #252: which optional trailing-JSON fields the prompt requested —
 * read off the prompt text itself. A field counts as requested when the
 * template names it quoted, as the output-shape JSON example does.
 * Unrequested fields in a reply are ignored, never stored. Generic over
 * the field list: adding a field to `READER_RESULT_FIELDS` picks it up
 * with no per-field code.
 */
export function requestedReaderFields(templateBody: string): string[] {
  return (READER_RESULT_FIELDS as readonly string[]).filter((f) => templateBody.includes(`"${f}"`));
}

/**
 * Root card id for the reader's card at `index`. Streamed cards and the
 * final apply must agree on this, or the final apply stores each streamed
 * card a second time (#28).
 */
export function readerCardId(index: number, cardIds: string[] = [], title?: string | null): string {
  // Issue #198/#212: the reader's settled order is problem, the one
  // central-idea card, per-plotline card(s) when there are several
  // plotlines, "How it's built up", "Decisions and questions", "Names".
  // Known titles win over position, so the per-plotline cards (any
  // count) never steal the `buildup`/`decisions`/`names` ids. The
  // `decisions` id is kept for the renamed card so existing anchors
  // (`#C-decisions`, `card:decisions#…`) stay valid; `names` is the new
  // card's stable id. No migration: card ids are assigned at apply time.
  if (cardIds[index]) return cardIds[index];
  const t = (title ?? "").trim().toLowerCase();
  if (t === "the problem") return "problem";
  if (t === "the central idea" || t === "the central change") return "central";
  if (t === "how it's built up") return "buildup";
  if (t === "decisions and questions") return "decisions";
  if (t === "names") return "names";
  // An unknown title at index 0/1 is still the problem / central card;
  // anywhere else it is a per-plotline card, never the buildup,
  // decisions or names card (those carry their known titles).
  return index === 0 ? "problem" : index === 1 ? "central" : `reader-${index}`;
}

/** True for ids `readerCardId` hands out when the reply names none. */
export function isDefaultReaderCardId(id: string): boolean {
  return id === "problem" || id === "central" || id === "buildup" || id === "decisions" || id === "names" || /^reader-\d+$/.test(id);
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

/**
 * Split a reader reply into root cards + placeholders. `templateBody` is
 * the reader prompt text the reply answers (see `requestedReaderFields`):
 * only requested optional fields are kept — anything unrequested in the
 * reply is ignored, never stored.
 */
export function readerApply(
  parsedCards: { title: string | null; blocks: Block[] }[],
  data: Record<string, unknown> | null,
  templateBody: string,
): ReaderApply {
  const requested = new Set(requestedReaderFields(templateBody));
  const keep = <T>(key: string, value: T[] | undefined): T[] => (requested.has(key) ? (value ?? []) : []);
  const cardIds = keep<string>("cardIds", data?.["cardIds"] as string[] | undefined);
  const cards = dropReaderPreamble(parsedCards).map((c, i) => ({
    id: readerCardId(i, cardIds, c.title),
    title: c.title,
    blocks: c.blocks,
  }));
  const pendingCards = (
    keep<{ id?: string; label?: string; why?: string }>(
      "pendingCards",
      data?.["pendingCards"] as { id?: string; label?: string; why?: string }[] | undefined,
    )
  ).map((p) => ({
    id: p.id ?? `g-${Math.random().toString(36).slice(2, 8)}`,
    label: p.label ?? "(untitled)",
    why: p.why ?? "",
  }));
  const plotlines = (
    keep<{ id?: string; name?: string; description?: string; buildsOn?: string; hunks?: string[] }>(
      "plotlines",
      data?.["plotlines"] as { id?: string; name?: string; description?: string; buildsOn?: string; hunks?: string[] }[] | undefined,
    )
  ).map((p) => ({
    ...(p.id !== undefined ? { id: p.id } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.buildsOn !== undefined ? { buildsOn: p.buildsOn } : {}),
    ...(p.hunks !== undefined ? { hunks: p.hunks } : {}),
  }));
  const glossary = (
    keep<{ name?: string; definition?: string; citation?: string }>(
      "glossary",
      data?.["glossary"] as { name?: string; definition?: string; citation?: string }[] | undefined,
    )
  ).map((g) => ({
    ...(g.name !== undefined ? { name: g.name } : {}),
    ...(g.definition !== undefined ? { definition: g.definition } : {}),
    ...(g.citation !== undefined ? { citation: g.citation } : {}),
  }));
  return { cards, pendingCards, plotlines, glossary };
}

export interface CriticApply {
  pageId: string;
  title: string;
  confidence: string;
  summary: string;
  cards: { id: string; title: string | null; blocks: Block[] }[];
  suggestedComment?: { text: string; diff: string };
}

type FindingMeta = {
  id?: string;
  title?: string;
  confidence?: string;
  summary?: string;
  suggestedComment?: { text?: string; diff?: string };
  cardIds?: string[];
};

/** Group Evidence…Assessment card runs: an Assessment card closes a finding. */
function groupFindingCards(
  parsedCards: { title: string | null; blocks: Block[] }[],
  count: number,
): { title: string | null; blocks: Block[] }[][] {
  if (count <= 0 || parsedCards.length === 0) return [];
  if (count === 1) return [parsedCards];
  const groups: { title: string | null; blocks: Block[] }[][] = [];
  let cur: { title: string | null; blocks: Block[] }[] = [];
  for (const c of parsedCards) {
    cur.push(c);
    if ((c.title ?? "").trim().toLowerCase() === "assessment") {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) {
    if (groups.length > 0) groups[groups.length - 1].push(...cur);
    else groups.push(cur);
  }
  if (groups.length === count) return groups;
  // Fallback: even pairs (Evidence, Assessment) per finding.
  if (parsedCards.length === count * 2) {
    return Array.from({ length: count }, (_, i) => parsedCards.slice(i * 2, i * 2 + 2));
  }
  if (groups.length > count) {
    const head = groups.slice(0, count - 1);
    head.push(groups.slice(count - 1).flat());
    return head;
  }
  while (groups.length < count) groups.push([]);
  return groups;
}

/**
 * One critic reply → one finding page per finding (#215, owner: keep
 * all findings — no cap in the parser; the prompt asks for usually one
 * to three). The trailing `findings` array carries each finding's
 * metadata in card order; a lone `finding`/`title` trailer is one
 * finding. Zero findings is valid (no cards, no entries).
 * A finding with no blocks is dropped on its own (validated per finding).
 */
export function criticApplyAll(
  parsedCards: { title: string | null; blocks: Block[] }[],
  data: Record<string, unknown> | null,
  fallbackPageId: string,
): CriticApply[] {
  const rawFindings = data?.["findings"] as FindingMeta[] | undefined;
  let metas: FindingMeta[];
  if (Array.isArray(rawFindings)) {
    metas = rawFindings;
  } else if (data?.["finding"] || data?.["title"] || parsedCards.length > 0) {
    const finding = (data?.["finding"] as FindingMeta | undefined) ?? {};
    metas = [{
      ...finding,
      ...(typeof data?.["title"] === "string" ? { title: data["title"] as string } : {}),
      ...((data?.["cardIds"] as string[] | undefined) ? { cardIds: data?.["cardIds"] as string[] } : {}),
    }];
  } else {
    metas = [];
  }
  if (metas.length === 0) return [];
  const groups = groupFindingCards(parsedCards, metas.length);
  const out: CriticApply[] = [];
  metas.forEach((meta, idx) => {
    const cardsIn = groups[idx] ?? [];
    if (!cardsIn.some((c) => c.blocks.length > 0)) return;
    const pageId =
      typeof meta.id === "string" && /^[\w-]+$/.test(meta.id)
        ? meta.id
        : idx === 0
          ? fallbackPageId
          : `${fallbackPageId}-${idx + 1}`;
    const cardIds = meta.cardIds ?? (data?.["cardIds"] as string[] | undefined) ?? [];
    const suggested =
      meta.suggestedComment?.text && meta.suggestedComment?.diff
        ? { text: meta.suggestedComment.text, diff: meta.suggestedComment.diff }
        : undefined;
    out.push({
      pageId,
      title: meta.title ?? cardsIn[0]?.title ?? "Finding",
      confidence: meta.confidence ?? "medium",
      summary: meta.summary ?? "",
      cards: cardsIn.map((c, i) => ({
        id: cardIds[i] ?? `${pageId}-${i}`,
        title: c.title,
        blocks: c.blocks,
      })),
      ...(suggested ? { suggestedComment: suggested } : {}),
    });
  });
  return out;
}

/** One critic reply → one finding page + optional suggested comment. */
export function criticApply(
  parsedCards: { title: string | null; blocks: Block[] }[],
  data: Record<string, unknown> | null,
  fallbackPageId: string,
): CriticApply {
  const all = criticApplyAll(parsedCards, data, fallbackPageId);
  return all[0] ?? {
    pageId: fallbackPageId,
    title: (data?.["title"] as string | undefined) ?? parsedCards[0]?.title ?? "Finding",
    confidence: "medium",
    summary: "",
    cards: [],
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
  const replyId = `ans_${id.replace(/[^0-9a-f]/gi, "").slice(0, 6) || "seed"}`;
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    id,
    type: "thread",
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
    replies: [{
      id: replyId,
      kind: "comment",
      who: "agent",
      question: null,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: esc }, citations: [] }],
      level: "standard",
      revision: 1,
      undoStack: [],
      suggested: true,
    }],
    post: false,
  };
}

export function conceptPage(id: string, title: string, blocks: Block[]): Page {
  return {
    id,
    kind: "concept",
    title,
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
    parent: "root",
    confidence,
    summary,
    cards: cards.map((c) => mkCard(c.id, pageId, c.title, c.blocks)),
  };
}
