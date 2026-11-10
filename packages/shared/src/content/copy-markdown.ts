/**
 * Copy-as-Markdown converter (issue #377).
 *
 * Builds the Markdown a card's copy icon puts on the clipboard: the card
 * as shown — title heading, blocks at the current depth level, the active
 * persona variant's blocks — with citations rewritten as portable text
 * (GitHub permalinks on PR reviews, plain `path:lines` elsewhere) and
 * internal `[[…]]` link tokens replaced by their visible labels.
 *
 * Pure: no Node or DOM APIs. The web builds the context from the snapshot
 * (`contextFromSnapshot`); unit tests construct it by hand.
 */
import type { Block, Citation, DepthLevel } from "../entities.js";
import type { ReviewSnapshot } from "../api.js";
import { parseId } from "../ids.js";
import { githubFileUrl } from "../repos.js";
import { displayCardTitle } from "./titles.js";

/** Where a copied citation can point on GitHub. */
export interface CopyMarkdownRepo {
  owner: string;
  name: string;
}

/**
 * Everything the converter needs from the review. `isPR` selects
 * permalinks vs plain text; `filePath`/`hunkRange` resolve stored keys.
 */
export interface CopyMarkdownContext {
  /** Owner/name for permalinks; null renders plain `path:lines` (local/branch reviews). */
  repo: CopyMarkdownRepo | null;
  /** True on PR reviews: citations become blob permalinks at `headSha`. */
  isPR: boolean;
  /** Head commit SHA revision permalinks point at. */
  headSha: string;
  /** File path for a diff/h file key, or null when unknown. */
  filePath: (fileKey: string) => string | null;
  /** New-side line range of a hunk, or null when the hunk is unknown. */
  hunkRange: (fileKey: string, contentHash: string) => { start: number; end: number } | null;
  /** Label for description citations ("PR description" / "Commits"). */
  descriptionLabel: string;
}

/** A guide page for finding-link rendering, by page id. */
export interface CopyMarkdownPage {
  title: string;
  confidence?: string;
  summary?: string;
}

/** Build the converter context from a snapshot and the review's repo (null when local/unknown). */
export function contextFromSnapshot(
  snapshot: ReviewSnapshot,
  repo: CopyMarkdownRepo | null,
): CopyMarkdownContext {
  const files = snapshot.files ?? [];
  return {
    repo,
    isPR: snapshot.review.prNumber != null && repo !== null,
    headSha: snapshot.version.headSha,
    filePath: (fileKey: string) => files.find((f) => f.fileKey === fileKey)?.path ?? null,
    hunkRange: (fileKey: string, contentHash: string) => {
      const hunk = files
        .find((f) => f.fileKey === fileKey)
        ?.hunks.find((h) => h.contentHash === contentHash);
      return hunk ? { start: hunk.newStart, end: hunk.newEnd } : null;
    },
    descriptionLabel: snapshot.review.prNumber == null ? "Commits" : "PR description",
  };
}

/** Decode the entities the parser emits into stored HTML. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** `10` or `10–20` (en dash, the same range style the UI chips use). */
function shortRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}

/**
 * Stored inline HTML (paragraphs, headings, list items, table cells) back
 * to Markdown. Dotted `a.cx` links (either `data-link` or the older
 * `data-node` spelling) and glossary `a.gx` links become their visible
 * label; external links keep `[label](url)`; everything else is unwrapped
 * to text. Code spans are protected first so their content is never
 * re-interpreted.
 */
export function htmlInlineToMarkdown(html: string): string {
  const codes: string[] = [];
  let s = html.replace(/<code>([\s\S]*?)<\/code>/gi, (_m, code: string) => {
    const text = decodeEntities(stripTags(code));
    codes.push(text.includes("`") ? "`` " + text + " ``" : "`" + text + "`");
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Dotted in-app links → visible label (concept/card/page links, issue #377).
  s = s.replace(
    /<a\s[^>]*class="cx"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, inner: string) => stripTags(inner),
  );
  // Glossary term links → the term itself.
  s = s.replace(
    /<a\s[^>]*class="gx"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, inner: string) => stripTags(inner),
  );
  // External links stay links.
  s = s.replace(
    /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => `[${stripTags(inner).trim() || decodeEntities(href)}](${decodeEntities(href)})`,
  );
  // Any other anchor (or a `data-src` source button) → its text.
  s = s.replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, (_m, inner: string) => stripTags(inner));
  s = s.replace(
    /<(?:button|span)[^>]*data-src="[^"]*"[^>]*>([\s\S]*?)<\/(?:button|span)>/gi,
    (_m, inner: string) => stripTags(inner),
  );
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_m, _t: string, inner: string) => `**${stripTags(inner)}**`);
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_m, _t: string, inner: string) => `*${stripTags(inner)}*`);
  s = s.replace(/<(del|s|strike)>([\s\S]*?)<\/\1>/gi, (_m, _t: string, inner: string) => `~~${stripTags(inner)}~~`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = decodeEntities(stripTags(s));
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => codes[Number(n)]);
  // Collapse horizontal whitespace; keep intentional line breaks.
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * One stored citation → portable Markdown. `diff:`/`code:` ranges become
 * `[path:lines](permalink)` at the head commit on PR reviews (issue #377:
 * `diff:` tokens address new-side lines, so the permalink is the new-side
 * blob — the same rule as the selection toolbar) and plain `path:lines`
 * on local/branch reviews. `h:` hunks link their new-side range; `desc:`
 * and `doc:` are plain text; anything unparseable stays as plain text so
 * the output never contains `[[…]]` tokens or raw IDs.
 */
export function citationToMarkdown(target: string, ctx: CopyMarkdownContext): string {
  const parsed = parseId(target);
  if (!parsed) return target;
  if (parsed.kind === "diff" || parsed.kind === "code") {
    const path = parsed.kind === "diff" ? (ctx.filePath(parsed.fileKey) ?? parsed.fileKey) : parsed.path;
    const label = `${basename(path)}:${shortRange(parsed.start, parsed.end)}`;
    if (ctx.isPR && ctx.repo && ctx.headSha) {
      const last = parsed.end === parsed.start ? undefined : parsed.end;
      return `[${label}](${githubFileUrl(ctx.repo.owner, ctx.repo.name, ctx.headSha, path, parsed.start, last)})`;
    }
    return label;
  }
  if (parsed.kind === "h") {
    const path = ctx.filePath(parsed.fileKey);
    const name = path ? basename(path) : parsed.fileKey;
    const range = ctx.hunkRange(parsed.fileKey, parsed.contentHash);
    if (!range) return name;
    const label = `${name}:${shortRange(range.start, range.end)}`;
    if (ctx.isPR && ctx.repo && ctx.headSha && path) {
      const last = range.end === range.start ? undefined : range.end;
      return `[${label}](${githubFileUrl(ctx.repo.owner, ctx.repo.name, ctx.headSha, path, range.start, last)})`;
    }
    return label;
  }
  if (parsed.kind === "desc") return `${ctx.descriptionLabel} · ${parsed.paragraph}`;
  if (parsed.kind === "doc") return `Document · ${parsed.blockId}`;
  if (parsed.kind === "concept") return parsed.slug;
  if (parsed.kind === "page") return parsed.pageId;
  if (parsed.kind === "card") return parsed.blockId ? `${parsed.cardId}#${parsed.blockId}` : parsed.cardId;
  if (parsed.kind === "ann") return parsed.reply === undefined ? parsed.id : `${parsed.id}#r${parsed.reply}`;
  return target;
}

/** Trailing citation string for a block (` …` + space-joined citations, or ""). */
function citeSuffix(citations: Citation[], ctx: CopyMarkdownContext): string {
  if (citations.length === 0) return "";
  return ` ${citations.map((c) => citationToMarkdown(c.target, ctx)).join(" ")}`;
}

/** Per-depth text for a paragraph at the card's level (same rule as the renderer). */
function depthHtmlText(
  text: { simple?: string; standard: string; deep?: string },
  level: DepthLevel,
): string {
  if (level === "simple") return text.simple ?? text.standard;
  if (level === "deep") return text.deep ?? text.standard;
  return text.standard;
}

/** Stored `<table>` HTML → a GitHub pipe table. */
export function tableHtmlToMarkdown(html: string): string {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      htmlInlineToMarkdown(c[1]).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim(),
    );
    rows.push(cells);
  }
  if (rows.length === 0) return htmlInlineToMarkdown(html);
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
 * One list item's stored HTML → Markdown lines. Embedded fences, tables
 * and nested lists (which the parser embeds as HTML inside the item)
 * become their own lines; the item's own text stays on the first line.
 */
function listItemToLines(html: string): string[] {
  const chunks: string[] = [];
  let s = html;
  s = s.replace(/<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi,
    (_m, lang: string | undefined, code: string) => {
      chunks.push(`\`\`\`${lang ?? ""}\n${decodeEntities(stripTags(code)).replace(/\n$/, "")}\n\`\`\``);
      return `\u0000${chunks.length - 1}\u0000`;
    });
  s = s.replace(/<table>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    chunks.push(tableHtmlToMarkdown(`<table>${inner}</table>`));
    return `\u0000${chunks.length - 1}\u0000`;
  });
  s = s.replace(/<(ul|ol)([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, _t: string, _a: string, inner: string) => {
    const items = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((li) =>
      htmlInlineToMarkdown(li[1]).replace(/\s+/g, " ").trim(),
    );
    chunks.push(items.map((t) => `- ${t}`).join("\n"));
    return `\u0000${chunks.length - 1}\u0000`;
  });
  const text = htmlInlineToMarkdown(s.replace(/\u0000\d+\u0000/g, ""));
  const out = text ? [text] : [];
  for (const m of s.matchAll(/\u0000(\d+)\u0000/g)) out.push(chunks[Number(m[1])]);
  return out.length > 0 ? out : [""];
}

export interface BlockMarkdownOptions {
  /** Page lookup for finding-link blocks (title/confidence/summary). */
  findPage?: (pageId: string) => CopyMarkdownPage | null;
}

/** One block → Markdown lines (without the blank-line joins). */
function blockToLines(block: Block, level: DepthLevel, ctx: CopyMarkdownContext, opts: BlockMarkdownOptions): string[] {
  switch (block.type) {
    case "paragraph": {
      const text = htmlInlineToMarkdown(depthHtmlText(block.text, level));
      return [`${text}${citeSuffix(block.citations, ctx)}`.trim()];
    }
    case "heading": {
      const text = htmlInlineToMarkdown(block.html);
      return [`### ${text}${citeSuffix(block.citations, ctx)}`.trim()];
    }
    case "list": {
      const start = block.ordered ? (block.start ?? 1) : 1;
      const lines: string[] = [];
      block.items.forEach((item, i) => {
        const itemLines = listItemToLines(item.html);
        const marker = block.ordered ? `${start + i}.` : "-";
        const cites = citeSuffix(item.citations, ctx);
        lines.push(`${marker} ${itemLines[0]}${cites}`.trimEnd());
        for (const cont of itemLines.slice(1)) {
          for (const cl of cont.split("\n")) lines.push(`  ${cl}`);
        }
      });
      // Block-level citations no item shows land on the last item (the
      // same rule as the renderer: never a citation row of their own).
      const covered = new Set(block.items.flatMap((it) => it.citations.map((c) => c.target)));
      const uncovered = block.citations.filter((c) => !c.unverified && !covered.has(c.target));
      if (uncovered.length > 0 && lines.length > 0) {
        const suffix = uncovered.map((c) => citationToMarkdown(c.target, ctx)).join(" ");
        lines[lines.length - 1] = `${lines[lines.length - 1]} ${suffix}`.trimEnd();
      }
      return lines;
    }
    case "table": {
      const out = [tableHtmlToMarkdown(block.html)];
      const cites = citeSuffix(block.citations, ctx).trim();
      if (cites) out.push("", cites);
      return out;
    }
    case "code": {
      const out = [`\`\`\`${block.language ?? ""}\n${block.code}\n\`\`\``];
      const cites = citeSuffix(block.citations, ctx).trim();
      if (cites) out.push("", cites);
      return out;
    }
    case "diagram": {
      const out = [`\`\`\`d2\n${block.source}\n\`\`\``];
      if (block.caption) {
        const cap = htmlInlineToMarkdown(block.caption);
        // Italicize plain captions; captions that already carry
        // formatting render as-is so markers never nest ambiguously.
        out.push("", cap.includes("*") || cap.includes("_") ? cap : `*${cap}*`);
      }
      const cites = citeSuffix(block.citations, ctx).trim();
      if (cites) out.push("", cites);
      return out;
    }
    case "aside": {
      const inner = blocksToMarkdown(block.inner, level, ctx, opts).replace(/\n$/, "");
      const lines = [`> **${block.kind}**`];
      // The aside's own citations are the union of the inner blocks'
      // (see the parser), which already render inline — never repeat them.
      for (const line of inner.split("\n")) lines.push(line === "" ? ">" : `> ${line}`);
      return lines;
    }
    case "finding-link": {
      const page = opts.findPage?.(block.pageId);
      const confidence = page?.confidence ? ` · ${page.confidence} confidence` : "";
      const title = page?.title ?? block.pageId;
      const summary = page?.summary ? ` — ${page.summary}` : "";
      return [`**Agent finding${confidence}:** ${title}${summary}`];
    }
    case "comment-link": {
      return [`Suggested review comment on ${citationToMarkdown(block.diffRef, ctx)}`];
    }
    case "follow-up": {
      if (block.items.length === 0) return [];
      const lines = ["**Follow up:**"];
      for (const item of block.items) {
        lines.push(`- ${item.label}${item.ask ? ` — ${item.ask}` : ""}`);
      }
      return lines;
    }
    default:
      return [];
  }
}

/**
 * A block list → Markdown (blank line between blocks, single trailing
 * newline). The same converter serves guide cards, page cards and thread
 * answers: callers pass the blocks as shown (current depth level, active
 * persona variant).
 */
export function blocksToMarkdown(
  blocks: Block[],
  level: DepthLevel,
  ctx: CopyMarkdownContext,
  opts: BlockMarkdownOptions = {},
): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const lines = blockToLines(block, level, ctx, opts);
    if (lines.length > 0 && !(lines.length === 1 && lines[0] === "")) parts.push(lines.join("\n"));
  }
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}

/**
 * A card as shown → Markdown: the display title as a `##` heading plus
 * its blocks. `title` is the stored title (null when the reply carried
 * none); the shared fallback renders from `blocks` then, the same string
 * the card header shows.
 */
export function cardToMarkdown(
  card: { title: string | null; blocks: Block[] },
  level: DepthLevel,
  ctx: CopyMarkdownContext,
  opts: BlockMarkdownOptions = {},
): string {
  const title = displayCardTitle(card.title, card.blocks);
  const body = blocksToMarkdown(card.blocks, level, ctx, opts);
  return body ? `## ${title}\n\n${body}` : `## ${title}\n`;
}

/**
 * A thread answer as shown → Markdown: the reader's question (or the
 * answer kind) as a `##` heading plus its blocks.
 */
export function replyToMarkdown(
  reply: { question: string | null; kind: string; blocks: Block[] },
  level: DepthLevel,
  ctx: CopyMarkdownContext,
  opts: BlockMarkdownOptions = {},
): string {
  const fallback = reply.kind === "explain" ? "Explain" : reply.kind === "ask" ? "Ask" : "Answer";
  const title = reply.question?.trim() ? reply.question.trim() : fallback;
  const body = blocksToMarkdown(reply.blocks, level, ctx, opts);
  return body ? `## ${title}\n\n${body}` : `## ${title}\n`;
}
