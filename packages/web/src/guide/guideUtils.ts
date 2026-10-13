/**
 * Pure guide logic (web-guide owner): read roll-up, depth text selection,
 * preview text, link discovery, contents model, concept resolution, anchor
 * parsing. No DOM, no store — unit tested in `guideUtils.test.ts`.
 *
 * Inline dotted links come in two historical spellings: the prototype's
 * `<a class="cx" data-node="…">` and the content parser's
 * `<a class="cx" data-link="…">` (see `packages/shared/src/content/parse.ts`).
 * Everything here accepts both.
 */
import type { Block, Card, DepthLevel, Job, Page } from "@unvibe/shared";
import { displayCardTitle } from "@unvibe/shared";
import { stagePhrase } from "./stageLabels.js";

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
    (b) => b.type === "paragraph" || b.type === "list" || b.type === "code",
  );
  let raw = "";
  if (!block) return raw;
  if (block.type === "paragraph") raw = depthText(block.text, card.level);
  else if (block.type === "list") raw = block.items[0]?.html ?? "";
  else raw = block.code;
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
      if (block.type === "code") {
        const text = stripTags(block.code).replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    }
  }
  return "";
}

/** First-paragraph HTML of a page, for hover previews (PRD §4.5). */
export function pagePreviewHtml(page: Page): string | null {
  for (const card of page.cards) {
    if (card.pending) continue;
    for (const block of card.blocks) {
      if (block.type === "paragraph") return depthText(block.text, card.level);
    }
  }
  return null;
}

const NODE_ATTR = /data-(?:node|link)="([^"]+)"/g;

/** All dotted-link targets inside an HTML string. */
export function linkTargets(html: string | undefined): string[] {
  if (!html) return [];
  NODE_ATTR.lastIndex = 0;
  return [...html.matchAll(NODE_ATTR)].map((m) => m[1]);
}

/** Resolve a dotted-link target to a page id, if it addresses a page. */
export function pageIdForLinkTarget(
  target: string,
  lookup: (id: string) => Page | undefined,
): string | null {
  if (target.startsWith("page:")) {
    const id = target.slice("page:".length);
    return lookup(id) ? id : null;
  }
  if (target.startsWith("concept:")) {
    const page = lookupConceptPage(lookup, target.slice("concept:".length));
    return page ? page.id : null;
  }
  // Legacy bare page ids (prototype `data-node`).
  return lookup(target) ? target : null;
}

/**
 * Resolve a `concept:<slug>` link to its page. Concept pages carry ids of
 * the form `c-<slug>`.
 */
export function lookupConceptPage(
  lookup: (id: string) => Page | undefined,
  slug: string,
): Page | undefined {
  return lookup(`c-${slug}`);
}

/** Pages linked from a page's blocks (prototype `linkedPages`). */
export function linkedPages(page: Page, lookup: (id: string) => Page | undefined): Page[] {
  const ids = new Set<string>();
  const scan = (s: string | undefined): void => {
    for (const t of linkTargets(s)) {
      const id = pageIdForLinkTarget(t, lookup);
      if (id) ids.add(id);
    }
  };
  const walk = (b: Block): void => {
    if (b.type === "paragraph") {
      scan(b.text.standard);
      scan(b.text.simple);
      scan(b.text.deep);
    } else if (b.type === "list") {
      b.items.forEach((i) => scan(i.html));
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

/**
 * Expansion-opened pages under this page (M4; PRD §4.7 "Open as page"):
 * child pages (`parent === page.id`) of kind `opened-expansion`, listed in
 * the Contents box under linked pages.
 */
export function expansionOpenedPages(
  page: Page,
  allPages: Page[] | undefined,
): Page[] {
  if (!allPages) return [];
  return allPages.filter((p) => p.parent === page.id && p.kind === "opened-expansion");
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
 * Expansion-opened child pages list under linked pages (M4).
 */
export function contentsModel(
  page: Page,
  lookup: (id: string) => Page | undefined,
  allPages?: Page[],
): { cards: ContentsEntry[]; links: ContentsEntry[] } {
  const cards: ContentsEntry[] = page.cards
    .filter((c) => !("divider" in c))
    .map((c) => ({
      kind: "card" as const,
      id: c.id,
      // Issue #49: the real title, else the shared word-boundary
      // fallback — the same string the card header shows.
      title: c.title || c.pending?.label || displayCardTitle(null, c.blocks),
      read: c.read,
    }));
  const linked = linkedPages(page, lookup);
  const opened = allPages ? expansionOpenedPages(page, allPages) : [];
  const seen = new Set(linked.map((p) => p.id));
  for (const p of opened) {
    if (!seen.has(p.id)) {
      linked.push(p);
      seen.add(p.id);
    }
  }
  const links: ContentsEntry[] = linked.map((p) => ({
    kind: "page" as const,
    id: p.id,
    title: p.title,
    read: isPageRead(p),
  }));
  return { cards, links };
}

/**
 * Mark links to fully read pages as known (prototype `knownCls`): adds the
 * `known` class to `a.cx` anchors whose page is read. Accepts `page:`,
 * `concept:` and legacy bare page ids.
 */
export function markKnownLinks(html: string, pages: Page[]): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const lookup = (id: string): Page | undefined => byId.get(id);
  return html.replace(
    /<a class="cx" data-(node|link)="([^"]+)">/g,
    (m, attr: string, target: string) => {
      const pageId = pageIdForLinkTarget(target, lookup) ?? (byId.has(target) ? target : null);
      if (pageId) {
        const p = byId.get(pageId);
        if (p && isPageRead(p)) return `<a class="cx known" data-${attr}="${target}">`;
      }
      return m;
    },
  );
}

/**
 * Split an anchor block id of the form `cardId#blockId` (what the service
 * stores) into its parts. Bare ids address a block on an unknown card.
 */
export function splitAnchorBlockId(blockId: string): { cardId: string | null; block: string } {
  const hash = blockId.indexOf("#");
  if (hash < 0) return { cardId: null, block: blockId };
  return { cardId: blockId.slice(0, hash), block: blockId.slice(hash + 1) };
}

/** Does an annotation anchor address this card + block?
 *
 * Exact on owner AND block (#116): a bare block ID never matches (block
 * IDs restart at `b1` in every card and expansion, so an unqualified ID
 * would attach the annotation to every same-numbered block), and there
 * is no prefix matching (`b1` never matches `b10`). All stored anchors
 * are qualified `<owner>#<block>` at creation.
 */
export function anchorMatchesBlock(anchorBlockId: string, cardId: string, blockId: string): boolean {
  const split = splitAnchorBlockId(anchorBlockId);
  return split.cardId === cardId && split.block === blockId;
}

/** The running/queued job for a card, if any (PRD §4.4 pending state). */
export function jobForCard(jobs: Job[], cardId: string): Job | undefined {
  return jobs.find(
    (j) => j.cardId === cardId && (j.state === "running" || j.state === "queued"),
  );
}

/** Citation targets of a block (paragraph/list/table/code/diagram). */
export function blockCitations(block: Block): { target: string; unverified?: boolean }[] {
  if (
    block.type === "paragraph" ||
    block.type === "list" ||
    block.type === "table" ||
    block.type === "code" ||
    block.type === "diagram"
  ) {
    return block.citations;
  }
  return [];
}

/** What to say on the root route while the review has no guide pages yet. */
export type EmptyGuideState =
  | { kind: "building"; detail?: string }
  | { kind: "error"; detail: string }
  | { kind: "idle" };

/**
 * Why a review has no guide pages (issue #44): the pipeline is still
 * running, a stage failed, or it never started. Mirrors the service's
 * front-screen `guideStatusFor` (`reviews/list.ts`): live jobs first,
 * then the recorded stage states.
 */
export function emptyGuideState(
  pipeline: { stages: Record<string, string>; errors?: Record<string, string | undefined> } | undefined,
  jobs: Job[],
): EmptyGuideState {
  const live = jobs.filter((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
  if (live.length > 0) {
    return { kind: "building", detail: [...new Set(live.map((j) => j.kind))].slice(0, 3).join(", ") };
  }
  const stages = Object.entries(pipeline?.stages ?? {});
  const running = stages.filter(([, v]) => v === "running").map(([k]) => k);
  if (running.length > 0) return { kind: "building", detail: running.slice(0, 3).join(", ") };
  const failed = stages.find(([, v]) => v === "error");
  const failedJob = jobs.find((j) => j.state === "error");
  if (failed || failedJob) {
    const detail = (failed && pipeline?.errors?.[failed[0]]) ?? failedJob?.error;
    const stage = failed ? failed[0] : failedJob?.kind;
    return { kind: "error", detail: detail ?? `Something went wrong while ${stagePhrase(stage)}.` };
  }
  // Some stages done, the rest pending: the next job is about to be queued.
  if (stages.some(([, v]) => v === "done")) return { kind: "building" };
  return { kind: "idle" };
}
