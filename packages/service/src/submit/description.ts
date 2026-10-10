/**
 * Description editing round-trip (PRD 4.11, 15).
 *
 * `PUT /api/reviews/:id/description` stores the edited HTML locally as
 * pending. The edited HTML is converted back to Markdown such that content
 * outside edited paragraphs round-trips byte-for-byte against the original
 * PR body: the original Markdown source is kept per paragraph id and only
 * regenerated for paragraphs whose HTML changed. Edits keep paragraph
 * identity so citations and annotations still resolve.
 *
 * Pure functions here; the route wires them to `ReviewStore.mutate` + `gh`.
 */

import { renderInline, renderMarkdownBlocks } from "../ingest/description.js";

export interface RawBlock {
  kind: "heading" | "list" | "code" | "para";
  /** Paragraph id (`d-p<n>`) for non-headings; null for headings. */
  id: string | null;
  /** Exact original Markdown source slice (no trailing newline). */
  raw: string;
  /** Exact separator after the block (blank lines + line endings). */
  sepAfter: string;
  /** Heading level (1-4) for headings. */
  level?: number;
  ordered?: boolean;
}

interface Line {
  text: string;
  ending: string;
}

function splitLines(src: string): Line[] {
  const out: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m: RegExpExecArray | null;
  // Avoid the empty match at EOF producing a phantom line.
  while ((m = re.exec(src)) !== null) {
    const text = m[1];
    const ending = m[2];
    if (text === "" && ending === "" ) break;
    out.push({ text, ending });
    if (ending === "") break;
    if (re.lastIndex >= src.length) {
      // Trailing newline consumed; no further lines.
      break;
    }
  }
  return out;
}

/**
 * Split the original Markdown into raw blocks with the SAME block
 * boundaries + id assignment as `renderMarkdownBlocks` (ingest): headings
 * get no id, every other block gets `d-p<n>` in document order.
 */
export function splitRawBlocks(src: string): RawBlock[] {
  const lines = splitLines(src);
  interface Pending {
    kind: "heading" | "list" | "code" | "para";
    start: number;
    end: number;
    ordered?: boolean;
    level?: number;
  }
  const pendings: Pending[] = [];
  let i = 0;
  const isBlank = (t: string): boolean => /^\s*$/.test(t);
  while (i < lines.length) {
    const line = lines[i].text;
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      pendings.push({ kind: "heading", start: i, end: i, level: heading[1].length });
      i += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const start = i;
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].text)) {
        i += 1;
      }
      // Consume the closing fence when present (or EOF).
      const end = i < lines.length ? i : lines.length - 1;
      if (i < lines.length) i += 1;
      pendings.push({ kind: "code", start, end });
      continue;
    }
    const listMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      const start = i;
      const ordered = /^\s*\d+[.)]/.test(line);
      i += 1;
      while (i < lines.length) {
        if (isBlank(lines[i].text)) break;
        const m = lines[i].text.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        i += 1;
      }
      pendings.push({ kind: "list", start, end: i - 1, ordered });
      continue;
    }
    const start = i;
    i += 1;
    while (
      i < lines.length &&
      !isBlank(lines[i].text) &&
      !/^(#{1,4}\s|```)/.test(lines[i].text)
    ) {
      if (/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.test(lines[i].text)) break;
      i += 1;
    }
    const candidate = lines.slice(start, i);
    if (candidate.map((l) => l.text).join("").trim() === "") {
      continue;
    }
    pendings.push({ kind: "para", start, end: i - 1 });
  }

  // Raw + separators: raw excludes the block's trailing newline; sepAfter
  // carries it plus any blank lines up to the next block.
  const blocks: RawBlock[] = [];
  let n = 0;
  for (let bi = 0; bi < pendings.length; bi++) {
    const p = pendings[bi];
    let raw = "";
    for (let k = p.start; k <= p.end; k++) {
      raw += lines[k].text;
      if (k < p.end) raw += lines[k].ending;
    }
    const nextStart = bi + 1 < pendings.length ? pendings[bi + 1].start : lines.length;
    let sepAfter = lines[p.end]?.ending ?? "";
    for (let k = p.end + 1; k < nextStart; k++) {
      sepAfter += lines[k].text + lines[k].ending;
    }
    let id: string | null = null;
    if (p.kind !== "heading") {
      n += 1;
      id = `d-p${n}`;
    }
    blocks.push({
      kind: p.kind,
      id,
      raw,
      sepAfter,
      ...(p.level !== undefined ? { level: p.level } : {}),
      ...(p.ordered !== undefined ? { ordered: p.ordered } : {}),
    });
  }
  return blocks;
}

/** Build paragraph sources + rendered HTML for a fresh PR body. */
export function buildParagraphSources(baseMarkdown: string): {
  html: string;
  paragraphSources: Record<string, string>;
} {
  const rendered = renderMarkdownBlocks(baseMarkdown);
  const sources: Record<string, string> = {};
  for (const b of splitRawBlocks(baseMarkdown)) {
    if (b.id) sources[b.id] = b.raw;
  }
  return { html: rendered.html, paragraphSources: sources };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/** Inline HTML (code/strong/em/a) back to Markdown. */
export function htmlInlineToMarkdown(inner: string): string {
  let s = inner;
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, (_m, code: string) => `\`${decodeEntities(stripTags(code))}\``);
  s = s.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => `[${decodeEntities(stripTags(label)).trim()}](${href})`,
  );
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/gi, (_m, t: string) => `**${decodeEntities(stripTags(t))}**`);
  s = s.replace(/<b>([\s\S]*?)<\/b>/gi, (_m, t: string) => `**${decodeEntities(stripTags(t))}**`);
  s = s.replace(/<em>([\s\S]*?)<\/em>/gi, (_m, t: string) => `*${decodeEntities(stripTags(t))}*`);
  s = s.replace(/<i>([\s\S]*?)<\/i>/gi, (_m, t: string) => `*${decodeEntities(stripTags(t))}*`);
  s = decodeEntities(stripTags(s));
  return s.replace(/\s+/g, " ").trim();
}

/** One edited list (`<ul>`/`<ol>`) back to Markdown. */
function htmlListToMarkdown(inner: string, ordered: boolean): string {
  const items: string[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    items.push(htmlInlineToMarkdown(m[1]));
  }
  if (items.length === 0) {
    const fallback = htmlInlineToMarkdown(inner);
    return fallback ? `- ${fallback}` : "";
  }
  return items.map((t, idx) => (ordered ? `${idx + 1}. ${t}` : `- ${t}`)).join("\n");
}

/** One edited code block (`<pre>`) back to a fenced block. */
function htmlCodeToMarkdown(inner: string): string {
  let code = inner;
  const m = inner.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i);
  if (m) code = m[1];
  code = decodeEntities(stripTags(code));
  // Preserve internal newlines; drop a single trailing newline the renderer adds.
  code = code.replace(/\n$/, "");
  return `\`\`\`\n${code}\n\`\`\``;
}

function htmlHeadingToMarkdown(inner: string, level: number): string {
  const text = htmlInlineToMarkdown(inner);
  return `${"#".repeat(Math.min(4, Math.max(1, level)))} ${text}`;
}

/** Strip contenteditable artifacts (prototype `cleanDesc`). */
export function cleanEditedHtml(html: string): string {
  return html
    .replace(/ contenteditable="(true|false)"/g, "")
    .replace(/ id="descEdit"/g, "")
    .replace(/ spellcheck="(true|false)"/g, "")
    .replace('class="desc editing"', 'class="desc"')
    .replace(/<div class="author">[\s\S]*?<\/div>/, "");
}

interface ParsedBlock {
  id: string | null;
  tag: "p" | "ul" | "ol" | "pre" | "h3";
  inner: string;
}

/** Parse rendered/edited description HTML into blocks in document order. */
export function parseDescBlocks(html: string): ParsedBlock[] {
  const cleaned = cleanEditedHtml(html);
  const inner = cleaned.replace(/^[\s\S]*?<div class="desc"[^>]*>/i, "").replace(/<\/div>\s*$/, "");
  const out: ParsedBlock[] = [];
  const re = /<(p|ul|ol|pre|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const tag = m[1].toLowerCase() as ParsedBlock["tag"];
    const attrs = m[2];
    const body = m[3];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    out.push({ id: tag === "h3" ? null : (idMatch?.[1] ?? null), tag, inner: body });
  }
  return out;
}

function normalizeInnerForCompare(tag: ParsedBlock["tag"], inner: string): string {
  if (tag === "pre") return inner.trim();
  // Collapse whitespace + decode entities so browser re-serialization of
  // untouched paragraphs still matches the stored HTML.
  return decodeEntities(inner).replace(/\s+/g, " ").trim();
}

/**
 * Convert edited HTML back to Markdown, reusing the original source for
 * every paragraph whose HTML is unchanged. Unchanged content (tables, code
 * fences, lists, HTML comments, CRLF, trailing whitespace) round-trips
 * byte-for-byte because its raw source + separator are reused verbatim.
 */
export function editedHtmlToMarkdown(baseMarkdown: string, editedHtml: string): string {
  const origBlocks = splitRawBlocks(baseMarkdown);
  const origRendered = renderMarkdownBlocks(baseMarkdown);
  const origParsed = parseDescBlocks(origRendered.html);
  const origById = new Map<string, string>();
  for (const b of origParsed) {
    if (b.id) origById.set(b.id, normalizeInnerForCompare(b.tag, b.inner));
  }
  const origHeadings = origParsed.filter((b) => b.tag === "h3").map((b) => normalizeInnerForCompare(b.tag, b.inner));

  const origByIdFull = new Map<string, RawBlock>();
  const origHeadingBlocks: RawBlock[] = [];
  for (const b of origBlocks) {
    if (b.id) origByIdFull.set(b.id, b);
    else origHeadingBlocks.push(b);
  }

  const edited = parseDescBlocks(editedHtml);
  let headingIdx = -1;

  const pieces: Array<{ md: string; sep: string }> = [];
  for (const eb of edited) {
    if (eb.tag === "h3") {
      headingIdx += 1;
      const orig = origHeadingBlocks[headingIdx];
      const norm = normalizeInnerForCompare(eb.tag, eb.inner);
      if (orig && norm === (origHeadings[headingIdx] ?? "")) {
        pieces.push({ md: orig.raw, sep: orig.sepAfter });
      } else if (orig) {
        pieces.push({ md: htmlHeadingToMarkdown(eb.inner, orig.level ?? 3), sep: orig.sepAfter });
      } else {
        pieces.push({ md: htmlHeadingToMarkdown(eb.inner, 3), sep: "\n\n" });
      }
      continue;
    }
    if (!eb.id) {
      // Block without an id (should not happen for p/ul/ol/pre): convert.
      pieces.push({ md: blockToMarkdown(eb), sep: "\n\n" });
      continue;
    }
    const orig = origByIdFull.get(eb.id);
    const norm = normalizeInnerForCompare(eb.tag, eb.inner);
    if (!orig) {
      pieces.push({ md: blockToMarkdown(eb), sep: "\n\n" });
      continue;
    }
    if (norm === (origById.get(eb.id) ?? "")) {
      pieces.push({ md: orig.raw, sep: orig.sepAfter });
    } else {
      pieces.push({ md: blockToMarkdown(eb, orig), sep: orig.sepAfter });
    }
  }

  // Fix separators: every block except the last keeps its sep; the last
  // keeps its original trailing sep (usually "\n" or "").
  let out = "";
  for (let idx = 0; idx < pieces.length; idx++) {
    out += pieces[idx].md;
    if (idx < pieces.length - 1) {
      out += pieces[idx].sep || "\n\n";
    } else {
      out += pieces[idx].sep;
    }
  }
  void renderInline;
  return out;
}

function blockToMarkdown(eb: ParsedBlock, orig?: RawBlock): string {
  switch (eb.tag) {
    case "p":
      return htmlInlineToMarkdown(eb.inner);
    case "ul":
      return htmlListToMarkdown(eb.inner, false);
    case "ol":
      return htmlListToMarkdown(eb.inner, true);
    case "pre":
      return htmlCodeToMarkdown(eb.inner);
    case "h3":
      return htmlHeadingToMarkdown(eb.inner, orig?.level ?? 3);
  }
}

/** True when the edited HTML differs from the stored HTML at all. */
export function isDescriptionChanged(storedHtml: string, editedHtml: string): boolean {
  const a = parseDescBlocks(storedHtml).map((b) => `${b.tag}:${b.id ?? "-"}:${normalizeInnerForCompare(b.tag, b.inner)}`);
  const b = parseDescBlocks(editedHtml).map((x) => `${x.tag}:${x.id ?? "-"}:${normalizeInnerForCompare(x.tag, x.inner)}`);
  if (a.length !== b.length) return true;
  return a.some((v, idx) => v !== b[idx]);
}
