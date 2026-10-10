/**
 * Pure guide logic (M2, web-guide owner): read roll-up, depth text selection,
 * preview text, link discovery, contents model. No DOM, no store — unit
 * tested in `test/guideUtils.test.ts`.
 */
import type { Block, Card, DepthLevel, Page } from "@unvibe/shared";

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, " ");

/** Cards that count toward read state (prototype `readable`). */
export function readableCards(page: Page): Card[] {
  return page.cards.filter((c) => !c.pending);
}

/** A page is read when it has cards and all of them are read (PRD §4.4). */
export function isPageRead(page: Page): boolean {
  const cards = readableCards(page);
  return cards.length > 0 && cards.every((c) => c.read);
}

export function readCount(page: Page): number {
  return readableCards(page).filter((c) => c.read).length;
}

/** The per-depth text for a paragraph at the card's level (PRD §4.4). */
export function depthText(text: { simple?: string; standard: string; deep?: string }, level: DepthLevel): string {
  if (level === "simple") return text.simple ?? text.standard;
  if (level === "deep") return text.deep ?? text.standard;
  return text.standard;
}

/** Plain-text preview of a card (prototype `preview`). */
export function cardPreview(card: Card): string {
  const block = card.blocks.find(
    (b) => b.type === "paragraph" || b.type === "list" || b.type === "html",
  );
  let raw = "";
  if (!block) return raw;
  if (block.type === "paragraph") raw = depthText(block.text, card.level);
  else if (block.type === "list") raw = block.items[0]?.html ?? "";
  else raw = block.html;
  return stripTags(raw).replace(/\s+/g, " ").trim();
}

/** Plain-text preview of a page: title + first paragraph (PRD §4.5). */
export function pagePreview(page: Page): string {
  for (const card of page.cards) {
    for (const block of card.blocks) {
      if (block.type === "paragraph") {
        const text = stripTags(depthText(block.text, card.level))
          .replace(/\s+/g, " ")
          .trim();
        if (text) return text;
      }
      if (block.type === "html") {
        const text = stripTags(block.html).replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    }
  }
  return "";
}

const NODE_ATTR = /data-node="([^"]+)"/g;

/** Pages linked from a page's blocks (prototype `linkedPages`). */
export function linkedPages(page: Page, lookup: (id: string) => Page | undefined): Page[] {
  const ids = new Set<string>();
  const scan = (s: string | undefined): void => {
    if (!s) return;
    NODE_ATTR.lastIndex = 0;
    for (const m of s.matchAll(NODE_ATTR)) ids.add(m[1]);
  };
  const walk = (b: Block): void => {
    if (b.type === "paragraph") {
      scan(b.text.standard);
      scan(b.text.simple);
      scan(b.text.deep);
    } else if (b.type === "list") {
      b.items.forEach((i) => scan(i.html));
    } else if (b.type === "html") {
      scan(b.html);
    } else if (b.type === "finding-link") {
      ids.add(b.pageId);
    } else if (b.type === "aside") {
      b.inner.forEach(walk);
    }
  };
  page.cards.forEach((c) => c.blocks.forEach(walk));
  ids.delete(page.id);
  const out: Page[] = [];
  for (const id of ids) {
    const p = lookup(id);
    if (p) out.push(p);
  }
  return out;
}

export interface ContentsEntry {
  kind: "card" | "page";
  id: string;
  title: string;
  read: boolean;
}

/**
 * Contents box model (PRD §4.3): this page's cards (click to jump,
 * expanding if needed) plus linked pages. Read items are muted.
 */
export function contentsModel(
  page: Page,
  lookup: (id: string) => Page | undefined,
): { cards: ContentsEntry[]; links: ContentsEntry[] } {
  const cards: ContentsEntry[] = page.cards
    .filter((c) => !("divider" in c))
    .map((c) => ({
      kind: "card" as const,
      id: c.id,
      title: c.title || c.pending?.label || cardPreview(c).slice(0, 70),
      read: c.read,
    }));
  const links: ContentsEntry[] = linkedPages(page, lookup).map((p) => ({
    kind: "page" as const,
    id: p.id,
    title: p.title,
    read: isPageRead(p),
  }));
  return { cards, links };
}

/**
 * Mark links to fully read pages as known (prototype `knownCls`): adds the
 * `known` class to `a.cx[data-node]` anchors whose page is read.
 */
export function markKnownLinks(html: string, isRead: (pageId: string) => boolean): string {
  return html.replace(
    /<a class="cx" data-node="([^"]+)">/g,
    (m, id: string) => (isRead(id) ? `<a class="cx known" data-node="${id}">` : m),
  );
}

/** Citation targets of a block (paragraph/list/table/code/diagram/html). */
export function blockCitations(block: Block): { target: string; unverified?: boolean }[] {
  if (
    block.type === "paragraph" ||
    block.type === "list" ||
    block.type === "table" ||
    block.type === "code" ||
    block.type === "diagram" ||
    block.type === "html"
  ) {
    return block.citations;
  }
  return [];
}
