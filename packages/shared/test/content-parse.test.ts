import { describe, expect, it } from "vitest";
import {
  collectTargets,
  parseBlocks,
  parseCards,
  parseCardsPartial,
  parsePartial,
  parseReply,
  renderInline,
  renderMarkdown,
} from "../src/content/parse.js";

const GOLDEN = `## The problem

Python's \`http.client\` keeps the folded value [[desc:d-intro]] and urllib3 copied it into its [[concept:http-headers|HTTPHeaderDict]]. The pattern lives here [[diff:conn:80-82]].

::: simple
Simpler: old servers split headers across lines.
:::

- First item cites the helper [[diff:conn:91-110]]
- Second item has no citation

| Raw value | After |
|---|---|
| \`one\\r\\n two\` | \`one two\` |

\`\`\`python
x = _normalize("a")
\`\`\`

\`\`\`d2
direction: right
wire -> clean: unfold
wire: "On the wire" {link: "diff:conn:650-651"}
\`\`\`

Caption: The flow. [[diff:tsock:139-146]]

::: example
An example with \`code\`.
:::

### Follow-ups

- What about bare LF? | ask: bare lf
- Is order kept?

Finding: [[page:f-lf]]
`;

describe("parseBlocks golden", () => {
  it("parses every block kind with stable incremental IDs", () => {
    const cards = parseCards(GOLDEN);
    expect(cards.map((c) => c.title)).toEqual(["The problem"]);
    const blocks = cards[0].blocks;
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "list",
      "table",
      "code",
      "diagram",
      "aside",
      "follow-up",
      "finding-link",
    ]);
    expect(blocks.map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
      "b7",
      "b8",
    ]);

    const para = blocks[0];
    expect(para.type).toBe("paragraph");
    if (para.type !== "paragraph") return;
    expect(para.text.simple).toBe("Simpler: old servers split headers across lines.");
    expect(para.text.standard).toContain("<code>http.client</code>");
    expect(para.text.standard).toContain('data-link="concept:http-headers"');
    expect(para.text.standard).not.toContain("[[");
    expect(para.citations).toEqual([{ target: "desc:d-intro" }, { target: "diff:conn:80-82" }]);

    const list = blocks[1];
    expect(list.type).toBe("list");
    if (list.type !== "list") return;
    expect(list.ordered).toBe(false);
    expect(list.items[0].citations).toEqual([{ target: "diff:conn:91-110" }]);
    expect(list.items[1].citations).toEqual([]);
    expect(list.citations).toEqual([{ target: "diff:conn:91-110" }]);

    const table = blocks[2];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.html).toContain("<th>Raw value</th>");
    expect(table.html).toContain("<code>one\\r\\n two</code>");

    const code = blocks[3];
    expect(code.type).toBe("code");
    if (code.type !== "code") return;
    expect(code.language).toBe("python");
    expect(code.citations).toEqual([]);

    const diagram = blocks[4];
    expect(diagram.type).toBe("diagram");
    if (diagram.type !== "diagram") return;
    expect(diagram.caption).toContain("The flow.");
    expect(diagram.citations.map((c) => c.target).sort()).toEqual(
      ["diff:conn:650-651", "diff:tsock:139-146"].sort(),
    );

    const aside = blocks[5];
    expect(aside.type).toBe("aside");
    if (aside.type !== "aside") return;
    expect(aside.kind).toBe("Example");
    expect(aside.inner[0].id).toBe("b6-b1");

    const follow = blocks[6];
    expect(follow.type).toBe("follow-up");
    if (follow.type !== "follow-up") return;
    expect(follow.items).toEqual([
      { label: "What about bare LF?", ask: "bare lf" },
      { label: "Is order kept?" },
    ]);

    const finding = blocks[7];
    expect(finding).toMatchObject({ type: "finding-link", pageId: "f-lf" });
  });

  it("keeps IDs stable when the card is re-parsed with appended text", () => {
    const before = parseBlocks("First [[diff:conn:80-82]].\n\nSecond.\n");
    const after = parseBlocks("First [[diff:conn:80-82]].\n\nSecond.\n\nThird added later.\n");
    expect(after.slice(0, 2).map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2].id).toBe("b3");
  });

  it("collects citation and link targets for the validator", () => {
    const { citations, links } = collectTargets(parseBlocks("A [[diff:conn:1]] and [[concept:x|Ex]].\n"));
    expect(citations).toEqual(["diff:conn:1"]);
    expect(links).toEqual(["concept:x"]);
  });

  it("keeps unknown IDs as citations for the validator to flag", () => {
    const blocks = parseBlocks("Weird [[bogus:1]] token.\n");
    expect(blocks[0].type).toBe("paragraph");
    if (blocks[0].type !== "paragraph") return;
    expect(blocks[0].citations).toEqual([{ target: "bogus:1" }]);
  });

  it("treats mermaid fences as code, not diagrams (Mermaid removed)", () => {
    const blocks = parseBlocks("```mermaid\nflowchart LR\n```\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
    if (blocks[0].type !== "code") return;
    expect(blocks[0].language).toBe("mermaid");
  });

  it("parses d2 fences with link: cites and round-trips the caption", () => {
    const blocks = parseBlocks('```d2\ndirection: right\na -> b: go {link: "diff:conn:1-2"}\n```\n\nCaption: Flow.\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("diagram");
    if (blocks[0].type !== "diagram") return;
    expect(blocks[0].source).toContain('link: "diff:conn:1-2"');
    expect(blocks[0].citations).toEqual([{ target: "diff:conn:1-2" }]);
    expect(blocks[0].caption).toContain("Flow.");
    const back = parseBlocks(renderMarkdown(blocks));
    expect(back).toHaveLength(1);
    expect(back[0].type).toBe("diagram");
    if (back[0].type !== "diagram") return;
    expect(back[0].source).toBe(blocks[0].source);
  });

  it("stamps a seed-version hash placeholder so the endpoint can serve pre-rendered SVGs", async () => {
    const { diagramHash, canonicalizeD2Source, D2_MIN_VERSION } = await import("../src/content/d2.js");
    const blocks = parseBlocks("```d2\na -> b\n```\n");
    expect(blocks[0].type).toBe("diagram");
    if (blocks[0].type !== "diagram") return;
    expect(blocks[0].render).toEqual({
      hash: diagramHash(canonicalizeD2Source("a -> b"), D2_MIN_VERSION),
      status: "unavailable",
    });
  });

  it("round-trips blocks through renderMarkdown", () => {
    // Citation tokens are block-level: rendering appends them at the end,
    // so interior spacing may differ while structure stays identical.
    // Compare with prose whitespace-normalised (code/d2/tables exact).
    const normText = (s: string): string => s.replace(/\s+/g, " ").trim();
    const norm = (blocks: import("../src/entities.js").Block[]): unknown =>
      blocks.map((b) => {
        if (b.type === "paragraph") {
          return {
            ...b,
            text: {
              standard: normText(b.text.standard),
              ...(b.text.simple ? { simple: normText(b.text.simple) } : {}),
              ...(b.text.deep ? { deep: normText(b.text.deep) } : {}),
            },
          };
        }
        if (b.type === "list") {
          return { ...b, items: b.items.map((it) => ({ ...it, html: normText(it.html) })) };
        }
        if (b.type === "aside") {
          return { ...b, inner: norm(b.inner) };
        }
        if (b.type === "diagram" && b.caption) {
          return { ...b, caption: normText(b.caption) };
        }
        return b;
      });
    const blocks = parseCards(GOLDEN)[0].blocks;
    expect(norm(parseBlocks(renderMarkdown(blocks)))).toEqual(norm(blocks));
  });
});

describe("renderInline (Markdown inside a block)", () => {
  it("renders bold, italic, strikethrough and code spans", () => {
    expect(renderInline("**Recording.** record_cmd picks").html).toBe(
      "<strong>Recording.</strong> record_cmd picks",
    );
    expect(renderInline("*ital* and ~~gone~~ and `code`").html).toBe(
      "<em>ital</em> and <s>gone</s> and <code>code</code>",
    );
  });

  it("renders ordinary links with a new-tab target", () => {
    const r = renderInline("[docs](https://example.com/x)");
    expect(r.html).toBe(
      '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(r.citations).toEqual([]);
    expect(r.links).toEqual([]);
  });

  it("honours backslash escapes", () => {
    expect(renderInline("\\*not em\\*").html).toBe("*not em*");
  });

  it("keeps raw HTML escaped", () => {
    expect(renderInline("<b>hi</b>").html).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("rejects javascript: link targets", () => {
    const r = renderInline("[x](javascript:alert(1))");
    expect(r.html).not.toContain("<a");
    expect(r.html).toContain("[x](javascript:alert(1))");
  });

  it("still recognises tokens with underscores before emphasis runs", () => {
    const r = renderInline("a [[code:src/__init__.py:1-3]] b");
    expect(r.html).toBe("a  b");
    expect(r.citations).toEqual([{ target: "code:src/__init__.py:1-3" }]);
  });

  it("handles a token next to bold text", () => {
    const r = renderInline("**Hi** [[concept:x|Ex]]");
    expect(r.html).toBe('<strong>Hi</strong> <a class="cx" data-link="concept:x">Ex</a>');
    expect(r.links).toEqual(["concept:x"]);
  });

  it("keeps tokens inside code spans literal", () => {
    const r = renderInline("`[[code:x]]`");
    expect(r.html).toBe("<code>[[code:x]]</code>");
    expect(r.citations).toEqual([]);
    expect(r.links).toEqual([]);
  });

  it("renders emphasis inside table cells and list items", () => {
    const table = parseBlocks("| A |\n|---|\n| **bold** cell |\n");
    expect(table[0].type).toBe("table");
    if (table[0].type !== "table") return;
    expect(table[0].html).toContain("<td><strong>bold</strong> cell</td>");
    const list = parseBlocks("- **bold** item\n");
    expect(list[0].type).toBe("list");
    if (list[0].type !== "list") return;
    expect(list[0].items[0].html).toBe("<strong>bold</strong> item");
  });

  it("round-trips emphasis and links to plain Markdown text", () => {
    const blocks = parseBlocks("**Bold** and *ital* with [a link](https://example.com).\n");
    const back = renderMarkdown(blocks);
    expect(back).toContain("Bold and ital with a link.");
    expect(back).not.toMatch(/<[^>]*>|&\w+;/);
  });
});

describe("parsePartial (streaming)", () => {
  const STREAM = `Complete para with [[diff:conn:80-82]].

Growing tail with a token cut off mid-[[diff:conn:8`;

  it("withholds a paragraph cut off mid-token", () => {
    const partial = parsePartial(STREAM);
    expect(partial).toHaveLength(1);
    expect(partial[0].id).toBe("b1");
    // Once the tail completes, IDs stay stable.
    const full = parseBlocks(STREAM.replace("mid-[[diff:conn:8", "mid-token [[diff:conn:80]].\n"));
    expect(full[0]).toEqual(partial[0]);
    expect(full).toHaveLength(2);
  });

  it("withholds a table cut off mid-table", () => {
    const buf = "Intro done.\n\n| A | B |\n|---|---|\n| x | y |";
    expect(parsePartial(buf).map((b) => b.type)).toEqual(["paragraph"]);
    expect(parseBlocks(`${buf}\n| z | w |\n\n`).map((b) => b.type)).toEqual(["paragraph", "table"]);
  });

  it("withholds an unclosed fence but keeps closed ones", () => {
    const closed = "```d2\na -> b\n```\n\nTail growing";
    const partial = parsePartial(closed);
    expect(partial.map((b) => b.type)).toEqual(["diagram"]);
    const unclosed = "Done.\n\n```python\nx = 1";
    expect(parsePartial(unclosed).map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("streams cards as they finish", () => {
    const buf = "## One\n\nBody one.\n\n## Two\n\nBody two growing";
    const cards = parseCardsPartial(buf);
    expect(cards.map((c) => [c.title, c.finished])).toEqual([
      ["One", true],
      ["Two", false],
    ]);
    expect(cards[0].blocks).toHaveLength(1);
    expect(cards[1].blocks).toHaveLength(0);
    const done = parseCards(`${buf} end.\n`);
    expect(done[1].blocks).toHaveLength(1);
    expect(done[1].blocks[0].id).toBe("b1");
  });
});

describe("parseReply", () => {
  it("splits and parses in one call, keeping the JSON data", () => {
    const parsed = parseReply("Hi [[diff:conn:1]].\n\n```json\n{\"title\": \"T\"}\n```\n");
    expect(parsed.splitError).toBeNull();
    expect(parsed.data).toEqual({ title: "T" });
    expect(parsed.blocks).toHaveLength(1);
  });

  it("surfaces split errors without throwing", () => {
    const parsed = parseReply("Hi.\n\n```json\n{bad\n```\n");
    expect(parsed.splitError?.kind).toBe("malformed");
    expect(parsed.data).toBeNull();
    expect(parsed.blocks).toHaveLength(1);
  });
});
