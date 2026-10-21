/**
 * Document reviews (issue #222): a pasted Markdown document parsed into
 * paragraph blocks with stable IDs (`p1`, `p2`, … in document order),
 * cited as `doc:pN` and anchored as `document#pN` (the guide's block
 * anchor form with the document as its card). Pure: no Node or DOM APIs.
 *
 * Headings become heading blocks; everything else goes through the
 * shared reply parser (`parseBlocks`), so lists, tables, code fences and
 * inline formatting render exactly like guide content. Block IDs are
 * assigned here in document order and never reused within a document.
 */
import type { Block, DocumentBlock, DocumentContent } from "./entities.js";
import { parseBlocks, renderInline } from "./content/parse.js";

/** Card id the document's blocks are anchored under (`document#pN`). */
export const DOCUMENT_CARD_ID = "document";

/** Anchor block id for a document block (`document#p3`). */
export function documentAnchorBlockId(blockId: string): string {
  return `${DOCUMENT_CARD_ID}#${blockId}`;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text of a document block (prompts, previews, anchor matching). */
export function documentBlockText(block: DocumentBlock): string {
  const b = block.block;
  switch (b.type) {
    case "paragraph":
      return stripTags(b.text.standard);
    case "list":
      return b.items.map((it) => stripTags(it.html)).join("\n");
    case "table":
      return stripTags(b.html);
    case "code":
      return b.code;
    case "diagram":
      return [b.source, b.caption ?? ""].join("\n");
    case "aside":
      return b.inner.map((inner) =>
        inner.type === "paragraph" ? stripTags(inner.text.standard) : "",
      ).join("\n");
    default:
      return "";
  }
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```/;

/**
 * Parse pasted Markdown into a document. The title is the first H1's
 * text, else the first non-empty line, else `"Untitled document"`.
 * An empty document yields no blocks (creation refuses it upstream).
 */
export function parseDocumentMarkdown(markdown: string): DocumentContent {
  const src = markdown.replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const blocks: DocumentBlock[] = [];
  let counter = 0;
  const nextId = (): string => `p${++counter}`;
  let title = "";

  // Split into heading-headed chunks outside code fences.
  interface Chunk { heading?: { level: number; text: string }; body: string[] }
  const chunks: Chunk[] = [];
  let cur: Chunk = { body: [] };
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(HEADING) : null;
    if (h) {
      chunks.push(cur);
      cur = { heading: { level: h[1].length, text: h[2].trim() }, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  chunks.push(cur);

  for (const chunk of chunks) {
    if (chunk.heading) {
      const id = nextId();
      const rendered = renderInline(chunk.heading.text);
      blocks.push({
        id,
        kind: "heading",
        level: chunk.heading.level,
        block: { type: "paragraph", id, text: { standard: rendered.html }, citations: rendered.citations },
      });
      if (!title && chunk.heading.level === 1) title = stripTags(rendered.html);
    }
    const body = chunk.body.join("\n").trim();
    if (!body) continue;
    for (const b of parseBlocks(body) as Block[]) {
      const id = nextId();
      blocks.push({ id, kind: "content", block: { ...b, id } as Block });
    }
  }
  if (!title) {
    const first = blocks.find((b) => documentBlockText(b) !== "");
    title = first ? documentBlockText(first).slice(0, 120) : "Untitled document";
  }
  return { title: title || "Untitled document", markdown: src, blocks };
}
