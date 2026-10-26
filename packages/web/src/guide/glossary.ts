/**
 * Glossary linking for card text (issue #252).
 *
 * Exact, case-sensitive matches of glossary terms in card text link with
 * no agent. Only the first mention per card links; fenced code blocks,
 * existing links and headings are never passed here (callers transform
 * paragraph / list / table / aside HTML only; `CodeBlock`s render
 * separately and card titles render separately).
 */
import type { Block, DepthLevel, GlossaryEntry } from "@unvibe/shared";
import { linkGlossaryInHtml } from "@unvibe/shared";

function depthHtml(text: { simple?: string; standard: string; deep?: string }, level: DepthLevel): string {
  if (level === "simple") return text.simple ?? text.standard;
  if (level === "deep") return text.deep ?? text.standard;
  return text.standard;
}

/**
 * Clone card blocks with glossary links applied to the displayed text.
 * One shared `seen` set per card per render, so only the first mention
 * of each term across the card's blocks links. Depth variants other than
 * the card's current level are left alone (they link when shown).
 */
export function linkCardBlocks(blocks: Block[], glossary: GlossaryEntry[], level: DepthLevel): Block[] {
  if (glossary.length === 0) return blocks;
  const seen = new Set<string>();
  const link = (html: string): string => linkGlossaryInHtml(html, glossary, seen).html;
  const walk = (list: Block[]): Block[] =>
    list.map((b) => {
      switch (b.type) {
        case "paragraph": {
          const current = depthHtml(b.text, level);
          const linked = link(current);
          if (linked === current) return b;
          if (level === "simple") return { ...b, text: { ...b.text, simple: linked } };
          if (level === "deep") return { ...b, text: { ...b.text, deep: linked } };
          return { ...b, text: { ...b.text, standard: linked } };
        }
        case "list":
          return {
            ...b,
            items: b.items.map((it) => {
              const linked = link(it.html);
              return linked === it.html ? it : { ...it, html: linked };
            }),
          };
        case "table": {
          const linked = link(b.html);
          return linked === b.html ? b : { ...b, html: linked };
        }
        case "aside":
          return { ...b, inner: walk(b.inner) };
        default:
          return b;
      }
    });
  return walk(blocks);
}
