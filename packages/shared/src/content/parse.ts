/**
 * `parseBlocks`: Markdown (already stripped of its trailing JSON block by
 * {@link splitReply}) → the shared `Block[]` model.
 *
 * Reply conventions (also written down in `docs/reply-format.md`, which the
 * prompt templates copy):
 *
 * - `## Title` starts a new card (handled by `parseCards`); `parseBlocks`
 *   skips those lines. Text before the first `##` is one untitled card.
 * - A paragraph's citations are the `diff:`/`code:`/`desc:`/`h:` tokens it
 *   contains. They are stripped from the display text (a token with a
 *   `|label` keeps its label as plain text); the targets land in
 *   `block.citations` in first-seen order.
 * - Inline `concept:`/`page:`/`card:`/`ann:` tokens become links:
 *   `<a class="cx" data-link="<target>">label</a>`. Inline code
 *   (`` `code` ``) is preserved as `<code>` and never token-scanned.
 * - Per-depth text: a `::: simple` / `::: deep` container immediately after
 *   a paragraph attaches its content to that paragraph's `text.simple` /
 *   `text.deep`. With no preceding paragraph it becomes its own paragraph.
 * - Card titles are plain text (`## Title`).
 * - Diagrams: a fenced `d2` block → `DiagramBlock`. A paragraph
 *   starting with `Caption:` right after it becomes the caption. Citation
 *   targets from `link:` values are collected; the source keeps them
 *   verbatim. A fenced `mermaid` block is ordinary code, not a diagram.
 * - Follow-ups: a `### Follow-ups` heading turns the next list into a
 *   `FollowUpBlock`. Items are `Label` or `Label | ask: question`.
 * - Finding references: a paragraph holding exactly
 *   `Finding: [[page:<id>]]` → `FindingLinkBlock`.
 * - Asides: `::: example`, `::: principle` (or `::: underlying-principle`)
 *   and `::: diagram` containers → `AsideBlock` kinds `Example`,
 *   `Underlying principle`, `Diagram`; inner Markdown is parsed recursively.
 * - Tables use GitHub Markdown syntax → `TableBlock.html`. Lists may be
 *   ordered or unordered; each item keeps its own `citations` and the block
 *   carries the union. Unknown `:::` kinds render as plain text.
 * - Tokens whose ID does not parse are kept as citations with the raw
 *   target so the validator can report them as unverified.
 *
 * Block IDs are `b1, b2, …` in emit order (per card via `parseCards`, or
 * per `parseBlocks` call; `idPrefix` prepends). Re-parsing the same card
 * with appended text keeps every earlier ID stable. Aside inner blocks are
 * `<parent>-b1, …`.
 */
import type {
  AsideBlock,
  Block,
  Citation,
  DepthText,
  FollowUpItem,
  ListItem,
} from "../entities.js";
import { parseId, type ParsedId } from "../ids.js";
import { tokenizeLinks } from "../links.js";
import type { ParsedCard, ParseOptions, ReplyData, SplitError } from "./types.js";
import { splitReply } from "./split.js";
import { extractD2Links } from "./d2.js";

const CITATION_KINDS = new Set(["diff", "code", "desc", "h"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function defaultLinkLabel(id: ParsedId): string {
  switch (id.kind) {
    case "concept":
      return id.slug;
    case "page":
      return id.pageId;
    case "card":
      return id.blockId ? `${id.cardId}#${id.blockId}` : id.cardId;
    case "ann":
      return id.id;
    default:
      return "";
  }
}

interface InlineAcc {
  citations: Citation[];
  links: string[];
}

function pushCitation(acc: InlineAcc, target: string): void {
  if (!acc.citations.some((c) => c.target === target)) {
    acc.citations.push({ target });
  }
}

/** Render one token-free stretch: citations stripped, links linked. */
function renderPlain(seg: string, acc: InlineAcc): string {
  const toks = tokenizeLinks(seg);
  if (toks.length === 0) return escapeHtml(seg);
  let out = "";
  let pos = 0;
  for (const t of toks) {
    out += escapeHtml(seg.slice(pos, t.start));
    pos = t.end;
    const parsed = parseId(t.idText);
    if (parsed === null || CITATION_KINDS.has(parsed.kind)) {
      pushCitation(acc, t.idText);
      if (t.label !== undefined) out += escapeHtml(t.label);
    } else {
      acc.links.push(t.idText);
      const label = t.label ?? defaultLinkLabel(parsed);
      out += `<a class="cx" data-link="${escapeHtml(t.idText)}">${escapeHtml(label)}</a>`;
    }
  }
  return out + escapeHtml(seg.slice(pos));
}

export interface RenderedInline {
  html: string;
  citations: Citation[];
  links: string[];
}

/** Render inline Markdown: code spans preserved, tokens resolved. */
export function renderInline(text: string): RenderedInline {
  const acc: InlineAcc = { citations: [], links: [] };
  const parts = text.split(/(`[^`\n]+`)/g);
  let html = "";
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      html += `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    } else if (part) {
      html += renderPlain(part, acc);
    }
  }
  return { html, citations: acc.citations, links: acc.links };
}

function unionCitations(lists: Citation[][]): Citation[] {
  const out: Citation[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (!out.some((o) => o.target === c.target)) out.push({ ...c });
    }
  }
  return out;
}

const FOLLOW_UPS_HEADING = /^#{1,4}\s*follow-?ups?\s*$/i;
const CARD_HEADING = /^##\s+(.*)$/;
const FENCE_OPEN = /^```\s*([A-Za-z0-9_-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const DIRECTIVE_OPEN = /^:::\s*([A-Za-z][\w-]*)\s*$/;
const DIRECTIVE_CLOSE = /^:::\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_DELIM_CELL = /^:?-+:?$/;
const THEMATIC_BREAK = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const FINDING_LINE = /^finding:\s*(\[\[[^\]]+\]\])\s*$/i;

function isTableDelim(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => TABLE_DELIM_CELL.test(c));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function parseFollowItem(text: string): FollowUpItem {
  const pipe = text.indexOf("|");
  if (pipe < 0) return { label: text.trim() };
  const label = text.slice(0, pipe).trim();
  let ask = text.slice(pipe + 1).trim();
  ask = ask.replace(/^ask:\s*/i, "");
  const item: FollowUpItem = { label };
  if (ask) item.ask = ask;
  return item;
}

type AsideKind = AsideBlock["kind"];

function asideKindFor(name: string): AsideKind | "simple" | "deep" | null {
  switch (name) {
    case "simple":
    case "deep":
      return name;
    case "example":
      return "Example";
    case "principle":
    case "underlying-principle":
      return "Underlying principle";
    case "diagram":
      return "Diagram";
    default:
      return null;
  }
}

interface ListAcc {
  ordered: boolean;
  items: { text: string }[];
}

/**
 * Parse Markdown into blocks. IDs are `<idPrefix>b1, …` in emit order.
 * See the module docstring for the reply conventions.
 */
export function parseBlocks(markdown: string, opts?: ParseOptions): Block[] {
  const prefix = opts?.idPrefix ?? "";
  const blocks: Block[] = [];
  let counter = 0;
  const nextId = (): string => `${prefix}b${++counter}`;

  let para: string[] = [];
  let list: ListAcc | null = null;
  let followItems: string[] | null = null;
  let followUpNext = false;
  let table: string[] | null = null;
  let fence: { lang: string; lines: string[] } | null = null;
  let directive: { kind: string; lines: string[] } | null = null;
  let diagramAwaitingCaption = false;

  const clearCaptionWait = (): void => {
    diagramAwaitingCaption = false;
  };

  function flushPara(): void {
    if (para.length === 0) return;
    const raw = para.join(" ").trim();
    para = [];
    if (!raw) return;
    if (diagramAwaitingCaption) {
      const m = raw.match(/^caption:\s*(.*)$/i);
      if (m) {
        const last = blocks[blocks.length - 1];
        if (last?.type === "diagram") {
          const rendered = renderInline(m[1].trim());
          last.caption = rendered.html;
          last.citations = unionCitations([last.citations, rendered.citations]);
        }
        diagramAwaitingCaption = false;
        return;
      }
    }
    diagramAwaitingCaption = false;
    const finding = raw.match(FINDING_LINE);
    if (finding) {
      const inner = finding[1].slice(2, -2);
      const pipe = inner.indexOf("|");
      const idText = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
      const parsed = parseId(idText);
      if (parsed?.kind === "page") {
        blocks.push({ type: "finding-link", id: nextId(), pageId: parsed.pageId, citations: [] });
        return;
      }
    }
    const rendered = renderInline(raw);
    const text: DepthText = { standard: rendered.html };
    blocks.push({ type: "paragraph", id: nextId(), text, citations: rendered.citations });
  }

  function flushList(): void {
    if (followItems !== null) {
      const items = followItems.map(parseFollowItem).filter((i) => i.label);
      followItems = null;
      followUpNext = false;
      if (items.length > 0) {
        blocks.push({ type: "follow-up", id: nextId(), items, citations: [] });
      }
      clearCaptionWait();
      return;
    }
    if (list === null) return;
    const acc = list;
    list = null;
    if (acc.items.length === 0) return;
    const renderedItems: ListItem[] = acc.items.map((it) => {
      const r = renderInline(it.text);
      return { html: r.html, citations: r.citations };
    });
    blocks.push({
      type: "list",
      id: nextId(),
      ordered: acc.ordered,
      items: renderedItems,
      citations: unionCitations(renderedItems.map((i) => i.citations)),
    });
    clearCaptionWait();
  }

  function flushTable(): void {
    if (table === null) return;
    const rows = table;
    table = null;
    if (rows.length < 2) {
      // Not a real table (no delimiter row): demote to a paragraph.
      const rendered = renderInline(rows.join(" "));
      const text: DepthText = { standard: rendered.html };
      blocks.push({ type: "paragraph", id: nextId(), text, citations: rendered.citations });
      clearCaptionWait();
      return;
    }
    const header = splitRow(rows[0]);
    const bodyRows = rows.slice(2).map(splitRow);
    const cell = (content: string, tag: "th" | "td"): { html: string; citations: Citation[] } => {
      const r = renderInline(content);
      return { html: `<${tag}>${r.html || "&nbsp;"}</${tag}>`, citations: r.citations };
    };
    const headerCells = header.map((c) => cell(c, "th"));
    const bodyCells = bodyRows.map((r) => r.map((c) => cell(c, "td")));
    let html = "<table><tr>";
    for (const c of headerCells) html += c.html;
    html += "</tr>";
    for (const row of bodyCells) {
      html += "<tr>";
      for (let i = 0; i < header.length; i++) {
        html += row[i]?.html ?? "<td>&nbsp;</td>";
      }
      html += "</tr>";
    }
    html += "</table>";
    blocks.push({
      type: "table",
      id: nextId(),
      html,
      citations: unionCitations([
        ...headerCells.map((c) => c.citations),
        ...bodyCells.flatMap((r) => r.map((c) => c.citations)),
      ]),
    });
    clearCaptionWait();
  }

  function flushAll(): void {
    flushPara();
    flushList();
    flushTable();
  }

  function closeFence(f: { lang: string; lines: string[] }): void {
    if (f.lang === "d2") {
      const source = f.lines.join("\n").trim();
      const citations: Citation[] = [];
      for (const target of extractD2Links(source)) {
        pushCitation({ citations, links: [] }, target);
      }
      blocks.push({ type: "diagram", id: nextId(), source, citations });
      diagramAwaitingCaption = true;
    } else {
      blocks.push({
        type: "code",
        id: nextId(),
        ...(f.lang ? { language: f.lang } : {}),
        code: f.lines.join("\n"),
        citations: [],
      });
      clearCaptionWait();
    }
  }

  function closeDirective(kind: string, innerLines: string[]): void {
    const mapped = asideKindFor(kind);
    if (mapped === "simple" || mapped === "deep") {
      const rendered = renderInline(innerLines.join(" ").trim());
      const last = blocks[blocks.length - 1];
      if (last?.type === "paragraph") {
        last.text[mapped] = rendered.html;
        last.citations = unionCitations([last.citations, rendered.citations]);
      } else if (rendered.html) {
        const text: DepthText = { standard: rendered.html };
        blocks.push({ type: "paragraph", id: nextId(), text, citations: rendered.citations });
      }
      clearCaptionWait();
      return;
    }
    if (mapped !== null) {
      const id = nextId();
      const inner = parseBlocks(innerLines.join("\n"), { idPrefix: `${id}-` });
      blocks.push({
        type: "aside",
        id,
        kind: mapped,
        inner,
        citations: unionCitations(inner.map((b) => citationsOf(b))),
      });
      clearCaptionWait();
      return;
    }
    // Unknown ::: kind: lenient plain-text fallback (markers dropped).
    const rendered = renderInline(innerLines.join(" ").trim());
    if (rendered.html) {
      const text: DepthText = { standard: rendered.html };
      blocks.push({ type: "paragraph", id: nextId(), text, citations: rendered.citations });
    }
    clearCaptionWait();
  }

  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence !== null) {
      if (FENCE_CLOSE.test(line)) {
        const f = fence;
        fence = null;
        closeFence(f);
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    if (directive !== null) {
      if (DIRECTIVE_CLOSE.test(line)) {
        const d = directive;
        directive = null;
        closeDirective(d.kind, d.lines);
      } else {
        directive.lines.push(line);
      }
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      flushTable();
      if (list !== null || followItems !== null) flushList();
      continue;
    }

    const fenceOpen = line.match(FENCE_OPEN);
    if (fenceOpen) {
      flushAll();
      fence = { lang: (fenceOpen[1] ?? "").toLowerCase(), lines: [] };
      continue;
    }

    const dirOpen = line.match(DIRECTIVE_OPEN);
    if (dirOpen && line.trim().startsWith(":::")) {
      flushAll();
      directive = { kind: dirOpen[1].toLowerCase(), lines: [] };
      continue;
    }

    const cardTitle = line.match(CARD_HEADING);
    if (cardTitle && line.startsWith("## ")) {
      // Card boundary: parseCards owns these; parseBlocks skips them.
      flushAll();
      clearCaptionWait();
      continue;
    }
    if (FOLLOW_UPS_HEADING.test(line)) {
      flushAll();
      followUpNext = true;
      clearCaptionWait();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      // Other headings render as plain text (only ## and Follow-ups are structural).
      flushList();
      flushTable();
      para.push(line.replace(/^#{1,6}\s+/, "").trim());
      continue;
    }
    if (THEMATIC_BREAK.test(line.trim())) {
      flushAll();
      clearCaptionWait();
      continue;
    }

    const listMatch = line.match(LIST_ITEM);
    if (listMatch) {
      flushPara();
      flushTable();
      const ordered = /^\d/.test(listMatch[2].trim());
      const text = listMatch[3].trim();
      if (followUpNext) {
        if (followItems === null) followItems = [];
        followItems.push(text);
      } else {
        if (list !== null && list.ordered !== ordered) flushList();
        if (list === null) list = { ordered, items: [] };
        list.items.push({ text });
      }
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const next = lines[i + 1] ?? "";
      if (table !== null || isTableDelim(next)) {
        flushPara();
        if (list !== null || followItems !== null) flushList();
        if (table === null) table = [];
        table.push(line);
        continue;
      }
      // A lone |…| line without a delimiter row: paragraph text.
      if (table !== null) flushTable();
      if (list !== null || followItems !== null) flushList();
      para.push(line.trim());
      continue;
    }

    // Ordinary text (or blockquote content).
    if (table !== null) flushTable();
    if (list !== null || (followItems !== null && !followUpNext)) {
      // A non-list line ends an open list; a Follow-ups heading with no
      // list after it is ignored.
      if (followItems !== null) {
        followItems = null;
        followUpNext = false;
      } else {
        flushList();
      }
    } else if (followUpNext && followItems === null) {
      followUpNext = false;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    para.push((quote ? quote[1] : line).trim());
  }

  if (fence !== null) {
    // Lenient full parse: an unclosed fence still yields its block.
    // (Streaming uses parsePartial, which drops it instead.)
    const f = fence;
    fence = null;
    closeFence(f);
  }
  if (directive !== null) {
    const d = directive;
    directive = null;
    closeDirective(d.kind, d.lines);
  }
  flushAll();
  return blocks;
}

function citationsOf(block: Block): Citation[] {
  switch (block.type) {
    case "paragraph":
      return block.citations;
    case "list":
      return block.citations;
    case "table":
    case "code":
    case "diagram":
    case "finding-link":
    case "comment-link":
    case "follow-up":
      return block.citations;
    case "aside":
      return block.citations;
  }
}

export interface CollectedTargets {
  citations: string[];
  links: string[];
}

/** Collect every citation target + inline link target in blocks (deduped). */
export function collectTargets(blocks: Block[]): CollectedTargets {
  const citations: string[] = [];
  const links: string[] = [];
  const push = (arr: string[], v: string): void => {
    if (!arr.includes(v)) arr.push(v);
  };
  const scanHtml = (html: string): void => {
    for (const m of html.matchAll(/data-link="([^"]+)"/g)) push(links, m[1]);
  };
  const walk = (list: Block[]): void => {
    for (const b of list) {
      switch (b.type) {
        case "paragraph":
          for (const c of b.citations) push(citations, c.target);
          scanHtml(b.text.standard);
          if (b.text.simple) scanHtml(b.text.simple);
          if (b.text.deep) scanHtml(b.text.deep);
          break;
        case "list":
          for (const c of b.citations) push(citations, c.target);
          for (const it of b.items) {
            for (const c of it.citations) push(citations, c.target);
            scanHtml(it.html);
          }
          break;
        case "table":
          for (const c of b.citations) push(citations, c.target);
          scanHtml(b.html);
          break;
        case "code":
          break; // Fence content is literal; tokens there are not citations.
        case "diagram": {
          for (const c of b.citations) push(citations, c.target);
          if (b.caption) scanHtml(b.caption);
          break;
        }
        case "finding-link":
          push(links, `page:${b.pageId}`);
          for (const c of b.citations) push(citations, c.target);
          break;
        case "comment-link":
          // Finding page → suggested-comment thread (PRD §4.9). The diff
          // target travels in `citations` (canonical file key); the thread
          // id is a link so the validator checks it exists.
          push(links, `ann:${b.threadId}`);
          for (const c of b.citations) push(citations, c.target);
          break;
        case "follow-up":
          break;
        case "aside":
          for (const c of b.citations) push(citations, c.target);
          walk(b.inner);
          break;
      }
    }
  };
  walk(blocks);
  return { citations, links };
}

interface CardSection {
  title: string | null;
  markdown: string;
}

/** Split a reply body into card sections on `## Title` lines. */
export function splitCardSections(body: string): CardSection[] {
  const sections: CardSection[] = [];
  let current: CardSection = { title: null, markdown: "" };
  const chunks: string[] = [];
  const push = (): void => {
    current.markdown = chunks.join("\n");
    sections.push(current);
  };
  for (const line of body.split("\n")) {
    const m = line.match(CARD_HEADING);
    if (m && line.startsWith("## ")) {
      push();
      current = { title: m[1].trim() || null, markdown: "" };
      chunks.length = 0;
    } else {
      chunks.push(line);
    }
  }
  push();
  // Drop a leading empty section (reply starts straight with ##).
  if (sections.length > 1 && sections[0].title === null && !sections[0].markdown.trim()) {
    sections.shift();
  }
  // Drop a single wholly-empty section.
  if (sections.length === 1 && sections[0].title === null && !sections[0].markdown.trim()) {
    return [];
  }
  return sections;
}

/** Parse a reply body into cards (`## Title` boundaries). */
export function parseCards(body: string, opts?: ParseOptions): ParsedCard[] {
  return splitCardSections(body).map((s) => ({
    title: s.title,
    blocks: parseBlocks(s.markdown, opts),
    finished: true,
  }));
}

export interface ParsedReply {
  /** Markdown body without the trailing JSON fence. */
  body: string;
  cards: ParsedCard[];
  /** Top-level blocks (all cards concatenated); handy for validation. */
  blocks: Block[];
  /** Structured fields, null when the trailer was missing/malformed. */
  data: ReplyData | null;
  splitError: SplitError | null;
  rawJson: string | null;
}

/** `splitReply` + `parseCards` in one call. Never throws. */
export function parseReply(text: string, opts?: ParseOptions): ParsedReply {
  const split = splitReply(text);
  const body = split.ok ? split.body : split.body;
  const cards = parseCards(body, opts);
  return {
    body,
    cards,
    blocks: cards.flatMap((c) => c.blocks),
    data: split.ok ? split.data : null,
    splitError: split.ok ? null : split.error,
    rawJson: split.ok ? split.rawJson : null,
  };
}

function lastBlankLineCut(text: string): string {
  // End the prefix at the last blank line: everything before it is a
  // sequence of complete blocks. A buffer ending mid-paragraph, mid-list,
  // mid-table or mid-token has no trailing blank line, so its tail block
  // is excluded until more text arrives.
  const idx = text.search(/\n[ \t]*\n[ \t]*$/);
  if (idx >= 0) return text.slice(0, idx + 1);
  const m = text.match(/\n[ \t]*\n/g);
  if (!m) return "";
  const last = text.lastIndexOf(m[m.length - 1]);
  return text.slice(0, last + 1);
}

/**
 * Streaming entry point: given a growing text buffer, return the blocks
 * completed so far. A block counts as complete once a blank line (or the
 * closing fence, or the trailing JSON fence) ends it; the tail — a
 * paragraph/table/list still growing, an unclosed fence, a token cut off
 * mid-`[[…` — is held back. Cards are streamed as they finish: use
 * {@link parseCardsPartial} for card boundaries.
 */
export function parsePartial(buffer: string, opts?: ParseOptions): Block[] {
  const split = splitReply(buffer);
  if (split.ok) return parseBlocks(split.body, opts);
  let candidate = buffer;
  // Hold back an unclosed fenced block (odd number of ``` lines at end).
  const fenceLines = candidate.split("\n").filter((l) => /^```/.test(l)).length;
  if (fenceLines % 2 === 1) {
    const cut = candidate.lastIndexOf("```");
    candidate = candidate.slice(0, cut);
  }
  // Hold back an unclosed ::: directive container.
  const opens = (candidate.match(/^:::[ \t]*[A-Za-z][\w-]*[ \t]*$/gm) ?? []).length;
  const closes = (candidate.match(/^:::[ \t]*$/gm) ?? []).length;
  if (opens > closes) {
    const idx = candidate.search(/^:::[ \t]*[A-Za-z][\w-]*[ \t]*$/gm);
    if (idx >= 0) candidate = candidate.slice(0, idx);
  }
  return parseBlocks(lastBlankLineCut(candidate), opts);
}

/**
 * Streaming cards: all sections terminated by a later `##` are finished;
 * the still-growing last section contributes only its completed blocks
 * (`finished: false`). Call {@link parseCards} once the stream ends.
 */
export function parseCardsPartial(buffer: string, opts?: ParseOptions): ParsedCard[] {
  const split = splitReply(buffer);
  const body = split.ok ? split.body : buffer;
  const sections = splitCardSections(body);
  if (split.ok) {
    return sections.map((s) => ({
      title: s.title,
      blocks: parseBlocks(s.markdown, opts),
      finished: true,
    }));
  }
  return sections.map((s, i) => {
    if (i < sections.length - 1) {
      return { title: s.title, blocks: parseBlocks(s.markdown, opts), finished: true };
    }
    return { title: s.title, blocks: parsePartial(s.markdown, opts), finished: false };
  });
}

/** Decode the entities `escapeHtml`/`renderInline` produce. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function stripInlineTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/** Render stored inline HTML back to Markdown with `[[…]]` tokens. */
function inlineToMarkdown(html: string): string {
  let s = html.replace(
    /<code>([\s\S]*?)<\/code>/g,
    (_m, code: string) => `\`${decodeEntities(code)}\``,
  );
  s = s.replace(
    /<a class="cx" data-link="([^"]+)">([\s\S]*?)<\/a>/g,
    (_m, target: string, label: string) => `[[${target}|${decodeEntities(stripInlineTags(label))}]]`,
  );
  return decodeEntities(stripInlineTags(s));
}

function withCitations(text: string, citations: Citation[]): string {
  const trimmed = text.trim();
  if (citations.length === 0) return trimmed;
  return `${trimmed} ${citations.map((c) => `[[${c.target}]]`).join(" ")}`;
}

/** Render a stored `<table>` back to a GitHub pipe table. */
function tableToMarkdown(html: string): string {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
      inlineToMarkdown(c[1]).replace(/\|/g, "\\|"),
    );
    rows.push(cells);
  }
  if (rows.length === 0) return html;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const out = r.slice();
    while (out.length < width) out.push("");
    return out;
  };
  const head = `| ${pad(rows[0]).join(" | ")} |`;
  const delim = `|${" --- |".repeat(width)}`;
  const body = rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`);
  return [head, delim, ...body].join("\n");
}

/**
 * Render blocks back to the reply Markdown format (`parseBlocks` accepts
 * the output, modulo block IDs). Used where rendered prose must travel as
 * Markdown again, e.g. the context builder's guide input.
 */
export function renderMarkdown(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
        parts.push(withCitations(inlineToMarkdown(b.text.standard), b.citations));
        if (b.text.simple) parts.push(`::: simple\n${inlineToMarkdown(b.text.simple)}\n:::`);
        if (b.text.deep) parts.push(`::: deep\n${inlineToMarkdown(b.text.deep)}\n:::`);
        break;
      case "list":
        b.items.forEach((it, i) => {
          const marker = b.ordered ? `${i + 1}.` : "-";
          parts.push(`${marker} ${withCitations(inlineToMarkdown(it.html), it.citations)}`);
        });
        for (const c of b.citations) {
          if (!b.items.some((it) => it.citations.some((ic) => ic.target === c.target))) {
            parts.push(`[[${c.target}]]`);
          }
        }
        break;
      case "table":
        parts.push(withCitations(tableToMarkdown(b.html), b.citations));
        break;
      case "code":
        parts.push(`\`\`\`${b.language ?? ""}\n${b.code}\n\`\`\``);
        break;
      case "diagram":
        parts.push(`\`\`\`d2\n${b.source}\n\`\`\``);
        // Block citations are the `link:` values (kept verbatim above)
        // plus caption tokens; re-parsing dedupes them back to this set.
        if (b.caption) parts.push(`Caption: ${withCitations(inlineToMarkdown(b.caption), b.citations)}`);
        break;
      case "finding-link":
        parts.push(`Finding: [[page:${b.pageId}]]`);
        break;
      case "comment-link":
        // App-constructed (pipeline/builder attach it to the finding page
        // next to the suggested comment). One-directional: re-parsing
        // yields a paragraph; the snapshot is the source of truth.
        parts.push(`Comment: [[ann:${b.threadId}]] [[${b.diffRef}]]`);
        break;
      case "follow-up":
        parts.push("### Follow-ups");
        parts.push("");
        for (const it of b.items) {
          parts.push(it.ask ? `- ${it.label} | ask: ${it.ask}` : `- ${it.label}`);
        }
        break;
      case "aside": {
        const name = b.kind === "Example" ? "example" : b.kind === "Diagram" ? "diagram" : "principle";
        parts.push(`::: ${name}`);
        parts.push(renderMarkdown(b.inner).trim());
        parts.push(":::");
        break;
      }
    }
    parts.push("");
  }
  return `${parts.join("\n").trim()}\n`;
}
