/**
 * `parseBlocks`: Markdown (already stripped of its trailing JSON block by
 * {@link splitReply}) → the shared `Block[]` model.
 *
 * Reply conventions (also written down in `docs/reply-format.md`, which the
 * prompt templates copy):
 *
 * - `## Title` starts a new card (handled by `parseCards`); `parseBlocks`
 *   skips those lines. Text before the first `##` is a card with a null
 *   title (the prompts require a title for every page card, issue #49;
 *   the UI shows the shared fallback from `titles.ts` then).
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
 *   ordered or unordered (ordered lists keep their start number in `start`,
 *   absent means 1); each item keeps its own `citations` and the block
 *   carries the union. Blank lines never split a list, and continuation
 *   paragraphs, nested lists, fences and tables inside items stay inside
 *   the item. Unknown `:::` kinds render as plain text.
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
  ListBlock,
  ListItem,
} from "../entities.js";
import { parseId, type ParsedId } from "../ids.js";
import { tokenizeLinks, type LinkToken } from "../links.js";
import type { ParsedCard, ParseOptions, ReplyData, SplitError } from "./types.js";
import { splitReply } from "./split.js";
import { stripEchoFromCards } from "./titles.js";
import { extractD2Links, canonicalizeD2Source, diagramHash, D2_MIN_VERSION } from "./d2.js";
import MarkdownIt from "markdown-it";

const CITATION_KINDS = new Set(["diff", "code", "desc", "h", "doc"]);

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

/** Render one `[[…]]` token: citations stripped, links linked. */
function tokenHtml(t: LinkToken, acc: InlineAcc): string {
  const parsed = parseId(t.idText);
  if (parsed === null || CITATION_KINDS.has(parsed.kind)) {
    pushCitation(acc, t.idText);
    if (t.label !== undefined) return escapeHtml(t.label);
    return "";
  }
  acc.links.push(t.idText);
  const label = t.label ?? defaultLinkLabel(parsed);
  return `<a class="cx" data-link="${escapeHtml(t.idText)}">${escapeHtml(label)}</a>`;
}

// Inline Markdown inside a block (bold, italic, strikethrough, links,
// backslash escapes, code spans). Raw HTML stays escaped (`html: false` —
// the output lands in `dangerouslySetInnerHTML`), `javascript:` links are
// rejected by the default validation, and `linkify`/`typographer` stay off
// so file paths and identifiers are never rewritten.
const inlineMd = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Images are not part of the reply format: render them as literal text
// rather than emitting `<img>` tags into `dangerouslySetInnerHTML`.
inlineMd.disable("image");
// `[[…]]` tokens are recognised before emphasis runs: targets contain `_`
// and `*` (e.g. `[[code:src/__init__.py:1-3]]`) that must not become
// bold/italic. Code spans stay literal: `backticks` runs before this rule.
inlineMd.inline.ruler.before("emphasis", "cx_token", (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b) return false; // `[`
  const toks = tokenizeLinks(state.src.slice(state.pos));
  if (toks.length === 0 || toks[0].start !== 0) return false;
  // Silent mode (scanning a `[…]` label) must advance too, or markdown-it
  // throws "inline rule didn't increment state.pos" (#291).
  if (!silent) {
    const token = state.push("cx_token", "", 0);
    token.content = tokenHtml(toks[0], state.env.acc as InlineAcc);
  }
  state.pos += toks[0].end;
  return true;
});
inlineMd.renderer.rules.cx_token = (tokens, idx) => tokens[idx].content;
// Ordinary Markdown links open a new tab; dotted `a.cx` links stay in-app
// (the web click delegation only handles `a.cx` and `[data-src]`).
inlineMd.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, idx, options);
};

export interface RenderedInline {
  html: string;
  citations: Citation[];
  links: string[];
}

/** Render inline Markdown inside a block: emphasis, links, code spans, tokens. */
export function renderInline(text: string): RenderedInline {
  const acc: InlineAcc = { citations: [], links: [] };
  const html = inlineMd.renderInline(text, { acc });
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
const FINDING_LINE = /^finding:\s*(\[\[[^\]]+\]\])\s*$/i;

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

// Block structure follows markdown-it's block tokens (issue #314): tight
// and loose lists, ordered start numbers, continuation paragraphs, nested
// lists, tables, fences, headings and blockquotes. `:::` containers are not
// Markdown — they are split out before block parsing (fence-aware, as the
// old line scanner was) and handled by `closeDirective` unchanged.
const blockMd = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** One token stream from `blockMd.parse` (the `Token` class it returns). */
type BlockTokenStream = ReturnType<MarkdownIt["parse"]>;

interface MdChunk {
  type: "md";
  text: string;
}

interface DirectiveChunk {
  type: "directive";
  kind: string;
  lines: string[];
}

/**
 * Split top-level `:::` containers out of the Markdown. markdown-it has no
 * `:::` rule (it would read the markers as paragraph text), so containers
 * are fenced off first — fence-aware, so a `:::` line inside a fenced code
 * block stays code. An unclosed container runs to the end of input.
 */
function splitDirectives(markdown: string): (MdChunk | DirectiveChunk)[] {
  const chunks: (MdChunk | DirectiveChunk)[] = [];
  let md: string[] = [];
  let fence = false;
  let directive: { kind: string; lines: string[] } | null = null;
  const pushMd = (): void => {
    if (md.length > 0) {
      chunks.push({ type: "md", text: md.join("\n") });
      md = [];
    }
  };
  for (const line of markdown.split("\n")) {
    if (directive !== null) {
      if (DIRECTIVE_CLOSE.test(line)) {
        chunks.push({ type: "directive", kind: directive.kind, lines: directive.lines });
        directive = null;
      } else {
        directive.lines.push(line);
      }
      continue;
    }
    if (fence) {
      md.push(line);
      if (FENCE_CLOSE.test(line)) fence = false;
      continue;
    }
    if (FENCE_OPEN.test(line)) {
      md.push(line);
      fence = true;
      continue;
    }
    const dirOpen = line.match(DIRECTIVE_OPEN);
    if (dirOpen && line.trim().startsWith(":::")) {
      pushMd();
      directive = { kind: dirOpen[1].toLowerCase(), lines: [] };
      continue;
    }
    md.push(line);
  }
  if (directive !== null) {
    chunks.push({ type: "directive", kind: directive.kind, lines: directive.lines });
  }
  pushMd();
  return chunks;
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

  let followUpNext = false;
  let diagramAwaitingCaption = false;

  const clearCaptionWait = (): void => {
    diagramAwaitingCaption = false;
  };

  function emitParagraph(raw: string): void {
    // One logical paragraph: markdown-it's inline content joins wrapped
    // lines with `\n`; the old scanner joined them with spaces.
    const text = raw.replace(/\n/g, " ").trim();
    if (!text) return;
    if (diagramAwaitingCaption) {
      const m = text.match(/^caption:\s*(.*)$/i);
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
    const finding = text.match(FINDING_LINE);
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
    const rendered = renderInline(text);
    const paraText: DepthText = { standard: rendered.html };
    blocks.push({ type: "paragraph", id: nextId(), text: paraText, citations: rendered.citations });
  }

  function buildTableHtml(header: string[], bodyRows: string[][]): { html: string; citations: Citation[] } {
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
    return {
      html,
      citations: unionCitations([
        ...headerCells.map((c) => c.citations),
        ...bodyCells.flatMap((r) => r.map((c) => c.citations)),
      ]),
    };
  }

  function emitTable(header: string[], bodyRows: string[][]): void {
    if (header.length === 0) {
      // No header (unreachable from real table tokens): demote to a
      // paragraph, as the old scanner did without a delimiter row.
      const rendered = renderInline(bodyRows.flat().join(" "));
      const text: DepthText = { standard: rendered.html };
      blocks.push({ type: "paragraph", id: nextId(), text, citations: rendered.citations });
      clearCaptionWait();
      return;
    }
    const t = buildTableHtml(header, bodyRows);
    blocks.push({
      type: "table",
      id: nextId(),
      html: t.html,
      citations: t.citations,
    });
    clearCaptionWait();
  }

  function readTable(
    tokens: BlockTokenStream,
    openIdx: number,
  ): { header: string[]; rows: string[][]; end: number } {
    const end = findClose(tokens, openIdx);
    const header: string[] = [];
    const rows: string[][] = [];
    let section: "head" | "body" | null = null;
    let currentRow: string[] | null = null;
    for (let i = openIdx + 1; i < end; i++) {
      const t = tokens[i];
      if (t.type === "thead_open") section = "head";
      else if (t.type === "tbody_open") section = "body";
      else if (t.type === "tr_open") currentRow = [];
      else if (t.type === "tr_close") {
        if (currentRow !== null && section === "body") rows.push(currentRow);
        currentRow = null;
      } else if (t.type === "inline") {
        const prev = tokens[i - 1];
        if (prev?.type === "th_open") header.push(t.content);
        else if (prev?.type === "td_open") currentRow?.push(t.content);
      }
    }
    return { header, rows, end };
  }

  /** Index of the close token matching the open token at `openIdx`. */
  function findClose(tokens: BlockTokenStream, openIdx: number): number {
    const base = tokens[openIdx].type.replace(/_open$/, "");
    let depth = 0;
    for (let i = openIdx; i < tokens.length; i++) {
      if (tokens[i].type === `${base}_open`) depth++;
      else if (tokens[i].type === `${base}_close`) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return tokens.length - 1;
  }

  /** Index of the `list_item_close` matching the item open at `openIdx`. */
  function findItemClose(tokens: BlockTokenStream, openIdx: number, bound: number): number {
    let depth = 0;
    for (let i = openIdx; i < bound; i++) {
      if (tokens[i].type === "list_item_open") depth++;
      else if (tokens[i].type === "list_item_close") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return bound;
  }

  interface CollectedItem {
    /** Raw joined text (for follow-up parsing and inline rendering). */
    text: string;
    /** Embedded HTML that has no block of its own (nested lists, fences). */
    tailHtml: string;
    /** Citations from the embedded HTML. */
    tailCites: Citation[];
  }

  /**
   * Collect one list item's content. The flat `Block[]` model has no
   * nested blocks, so paragraphs join into the item text while nested
   * lists, fences and tables embed as HTML inside the item (their
   * citations bubble to the item and the block union).
   */
  function collectItem(tokens: BlockTokenStream, from: number, to: number): CollectedItem {
    const texts: string[] = [];
    const tailHtml: string[] = [];
    const tailCites: Citation[][] = [];
    let i = from;
    while (i < to) {
      const t = tokens[i];
      if (t.type === "paragraph_open") {
        const inline = tokens[i + 1];
        if (inline?.type === "inline") texts.push(inline.content);
        i += 3;
      } else if (t.type === "heading_open") {
        // Headings inside items demote to plain text, as at top level.
        const inline = tokens[i + 1];
        if (inline?.type === "inline") texts.push(inline.content);
        i += 3;
      } else if (t.type === "html_block") {
        texts.push(t.content);
        i += 1;
      } else if (t.type === "fence") {
        const lang = (t.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
        tailHtml.push(`<pre><code${cls}>${escapeHtml(t.content.replace(/\n$/, ""))}</code></pre>`);
        i += 1;
      } else if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
        const nested = buildList(tokens, i);
        const itemsHtml = nested.items.map((it) => `<li>${it.html}</li>`).join("");
        const tag = nested.ordered
          ? `ol${nested.start !== undefined && nested.start !== 1 ? ` start="${nested.start}"` : ""}`
          : "ul";
        tailHtml.push(`<${tag}>${itemsHtml}</${nested.ordered ? "ol" : "ul"}>`);
        tailCites.push(nested.citations);
        i = nested.end + 1;
      } else if (t.type === "table_open") {
        const table = readTable(tokens, i);
        const built = buildTableHtml(table.header, table.rows);
        tailHtml.push(built.html);
        tailCites.push(built.citations);
        i = table.end + 1;
      } else if (t.type === "blockquote_open") {
        const end = findClose(tokens, i);
        const inner = collectItem(tokens, i + 1, end);
        if (inner.text) texts.push(inner.text);
        if (inner.tailHtml) tailHtml.push(inner.tailHtml);
        tailCites.push(inner.tailCites);
        i = end + 1;
      } else {
        i += 1;
      }
    }
    return {
      text: texts.join(" ").replace(/\n/g, " ").trim(),
      tailHtml: tailHtml.join(""),
      tailCites: unionCitations(tailCites),
    };
  }

  interface BuiltList {
    ordered: boolean;
    start?: number;
    /** Normalized raw text per item (for follow-up parsing). */
    rawTexts: string[];
    items: ListItem[];
    citations: Citation[];
    /** Index of the list_close token. */
    end: number;
  }

  /**
   * Build one markdown-it list (tight or loose — blank lines never split
   * it) into a single `ListBlock`. A loose list growing by an item keeps
   * its block ID, which `parseCardsPartial` and streaming rely on.
   */
  function buildList(tokens: BlockTokenStream, openIdx: number): BuiltList {
    const open = tokens[openIdx];
    const ordered = open.type === "ordered_list_open";
    let start: number | undefined;
    if (ordered) {
      const raw = open.attrs?.find((a) => a[0] === "start")?.[1];
      const n = raw === undefined ? 1 : Number(raw);
      if (Number.isSafeInteger(n) && n !== 1) start = n;
    }
    const end = findClose(tokens, openIdx);
    const collected: CollectedItem[] = [];
    let i = openIdx + 1;
    while (i < end) {
      if (tokens[i].type === "list_item_open") {
        const itemEnd = findItemClose(tokens, i, end);
        collected.push(collectItem(tokens, i + 1, itemEnd));
        i = itemEnd + 1;
      } else {
        i += 1;
      }
    }
    const renderedItems: ListItem[] = collected.map((it) => {
      const r = renderInline(it.text);
      return { html: r.html + it.tailHtml, citations: unionCitations([r.citations, it.tailCites]) };
    });
    return {
      ordered,
      ...(start === undefined ? {} : { start }),
      rawTexts: collected.map((c) => c.text),
      items: renderedItems,
      citations: unionCitations(renderedItems.map((r) => r.citations)),
      end,
    };
  }

  function emitList(bl: BuiltList): void {
    if (followUpNext) {
      followUpNext = false;
      const items = bl.rawTexts.map(parseFollowItem).filter((it) => it.label);
      if (items.length > 0) {
        blocks.push({ type: "follow-up", id: nextId(), items, citations: [] });
      }
      clearCaptionWait();
      return;
    }
    const block: ListBlock = {
      type: "list",
      id: nextId(),
      ordered: bl.ordered,
      ...(bl.start === undefined ? {} : { start: bl.start }),
      items: bl.items,
      citations: bl.citations,
    };
    blocks.push(block);
    clearCaptionWait();
  }

  function closeFence(f: { lang: string; lines: string[] }): void {
    if (f.lang === "d2") {
      const source = f.lines.join("\n").trim();
      const citations: Citation[] = [];
      for (const target of extractD2Links(source)) {
        pushCitation({ citations, links: [] }, target);
      }
      // Placeholder render: hashed with the gated version (== the seed
      // version) so the endpoint can serve pre-rendered fixture SVGs — and
      // render on demand when the binary is present — before the pipeline
      // finalizes the block. Never empty: the web fetches by hash.
      blocks.push({
        type: "diagram",
        id: nextId(),
        source,
        citations,
        render: { hash: diagramHash(canonicalizeD2Source(source), D2_MIN_VERSION), status: "unavailable" },
      });
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

  function walkRange(tokens: BlockTokenStream, from: number, to: number): void {
    let i = from;
    while (i < to) {
      const t = tokens[i];
      switch (t.type) {
        case "paragraph_open": {
          const inline = tokens[i + 1];
          // A non-list line ends a pending Follow-ups heading with no list.
          if (followUpNext) followUpNext = false;
          emitParagraph(inline?.type === "inline" ? inline.content : "");
          i += 3;
          break;
        }
        case "fence": {
          emitFenceToken(t.info, t.content);
          i += 1;
          break;
        }
        case "heading_open": {
          const level = Number(t.tag.slice(1)) || 1;
          const inline = tokens[i + 1];
          const text = (inline?.type === "inline" ? inline.content : "").trim();
          if (t.tag === "h2") {
            // Card boundary: parseCards owns these; parseBlocks skips them.
            clearCaptionWait();
          } else if (
            level >= 1 &&
            level <= 4 &&
            FOLLOW_UPS_HEADING.test(`${"#".repeat(level)} ${text}`)
          ) {
            followUpNext = true;
            clearCaptionWait();
          } else {
            // Other headings render as plain text (only ## and Follow-ups
            // are structural).
            if (followUpNext) followUpNext = false;
            emitParagraph(text);
          }
          i += 3;
          break;
        }
        case "hr": {
          clearCaptionWait();
          i += 1;
          break;
        }
        case "bullet_list_open":
        case "ordered_list_open": {
          emitList(buildList(tokens, i));
          i = findClose(tokens, i) + 1;
          break;
        }
        case "blockquote_open": {
          // The old scanner stripped `>` markers into the surrounding
          // text; walk the quoted content as ordinary blocks.
          const end = findClose(tokens, i);
          walkRange(tokens, i + 1, end);
          i = end + 1;
          break;
        }
        case "table_open": {
          const table = readTable(tokens, i);
          emitTable(table.header, table.rows);
          i = table.end + 1;
          break;
        }
        case "html_block": {
          if (followUpNext) followUpNext = false;
          emitParagraph(t.content);
          i += 1;
          break;
        }
        default: {
          i += 1;
          break;
        }
      }
    }
  }

  function emitFenceToken(info: string, content: string): void {
    const lang = (info.trim().split(/\s+/)[0] ?? "").toLowerCase();
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    closeFence({ lang, lines });
  }

  for (const chunk of splitDirectives(markdown)) {
    if (chunk.type === "directive") {
      closeDirective(chunk.kind, chunk.lines);
    } else {
      const tokens = blockMd.parse(chunk.text, {});
      walkRange(tokens, 0, tokens.length);
    }
  }
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
  const cards = splitCardSections(body).map((s) => ({
    title: s.title,
    blocks: parseBlocks(s.markdown, opts),
  }));
  // Issue #50: deterministic echo strip. Each card additionally matches
  // its own title; streaming (`parseCardsPartial`) stays raw and the
  // final apply corrects it.
  if (opts?.echoCandidates === undefined) return cards;
  return stripEchoFromCards(cards, opts.echoCandidates);
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

/**
 * Streaming entry point: given a growing text buffer, return the finished
 * cards so far — sections closed by a later `## ` heading, or all sections
 * once the trailing JSON block is present. The still-growing last section
 * is simply not returned; nothing renders card content while it is being
 * written (PRD §11 only asks that cards appear as each one finishes).
 * Call {@link parseCards} once the stream ends.
 */
export function parseCardsPartial(buffer: string, opts?: ParseOptions): ParsedCard[] {
  const split = splitReply(buffer);
  const body = split.ok ? split.body : buffer;
  const sections = splitCardSections(body);
  if (split.ok) {
    return sections.map((s) => ({
      title: s.title,
      blocks: parseBlocks(s.markdown, opts),
    }));
  }
  return sections.slice(0, -1).map((s) => ({
    title: s.title,
    blocks: parseBlocks(s.markdown, opts),
  }));
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
      case "list": {
        const start = b.ordered ? (b.start ?? 1) : 1;
        b.items.forEach((it, i) => {
          const marker = b.ordered ? `${start + i}.` : "-";
          parts.push(`${marker} ${withCitations(inlineToMarkdown(it.html), it.citations)}`);
        });
        for (const c of b.citations) {
          if (!b.items.some((it) => it.citations.some((ic) => ic.target === c.target))) {
            parts.push(`[[${c.target}]]`);
          }
        }
        break;
      }
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
