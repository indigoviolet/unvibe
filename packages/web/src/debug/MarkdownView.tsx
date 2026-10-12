/**
 * Minimal safe Markdown renderer for the per-review debug page (issue #32).
 *
 * There is no Markdown library in the repo to reuse: guide cards and thread
 * answers render as service-built HTML (shared `Block[]`), while the debug
 * endpoint serves plain Markdown text. This renders that text with no new
 * dependency — headings, bullet lists (one nested level), fenced code
 * blocks, paragraphs, inline `code` and **bold** — and nothing else, so
 * diff/code lines (notably `#` comments and `[seq kind scope]` log lines)
 * stay literal. Everything renders as React text nodes (never
 * `dangerouslySetInnerHTML`), so the output is XSS-safe by construction.
 */
import { useMemo } from "react";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; text: string }
  | { type: "paragraph"; text: string };

interface ListItem {
  text: string;
  sub: string[];
}

const FENCE_OPEN = /^(`{3,})(\w*)\s*$/;

function splitBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE_OPEN.exec(line.trimStart());
    if (fence) {
      const run = fence[1].length;
      const close = new RegExp(`^\`{${run},}\\s*$`);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end)
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // `#` maps to h2: the page already owns the single h1.
      blocks.push({ type: "heading", level: Math.min(6, Math.max(2, heading[1].length)), text: heading[2] });
      i += 1;
      continue;
    }
    const listMarker = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMarker) {
      const ordered = /^\d/.test(listMarker[2].trim());
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // Indented continuation lines belong to the last item, so agent
          // text starting with `#`/`-` cannot break out of the list.
          const cont = /^ {2,}\S/.exec(lines[i]);
          if (cont && items.length > 0) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        if (m[1].length >= 2 && items.length > 0 && !ordered) {
          items[items.length - 1].sub.push(m[3]);
        } else if (m[1].length > 0 && items.length === 0) {
          break;
        } else {
          items.push({ text: m[3], sub: [] });
        }
        i += 1;
      }
      if (items.length > 0) blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE_OPEN.test(lines[i].trimStart()) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^(\s*)([-*]|\d+[.)])\s+/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length > 0) blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

/** Inline `code` and **bold**; everything else stays literal text. */
export function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return <span key={key}>{part}</span>;
  });
}

function MarkdownBlock({ block, index }: { block: Block; index: number }): React.JSX.Element {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={index}>{renderInline(block.text, `h${index}`)}</Tag>;
    }
    case "code":
      return (
        <pre className="code" key={index}>
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, j) => (
        <li key={j}>
          {renderInline(item.text, `li${index}-${j}`)}
          {item.sub.length > 0 ? (
            <ul>
              {item.sub.map((s, k) => (
                <li key={k}>{renderInline(s, `sub${index}-${j}-${k}`)}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ));
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    case "paragraph":
      return <p key={index}>{renderInline(block.text, `p${index}`)}</p>;
  }
}

export function MarkdownView({ markdown }: { markdown: string }): React.JSX.Element {
  const blocks = useMemo(() => splitBlocks(markdown), [markdown]);
  return (
    <>
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} index={i} />
      ))}
    </>
  );
}
