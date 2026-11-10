/**
 * Copy-as-Markdown converter (issue #377): the card as shown becomes
 * portable Markdown — current depth level, persona variant blocks,
 * lists, tables, asides, d2 diagrams, sub-headings, PR permalink
 * citations vs plain path:lines, link labels, and never any `[[`.
 */
import { describe, expect, it } from "vitest";
import type { Block, DepthLevel } from "../src/entities.js";
import {
  blocksToMarkdown,
  cardToMarkdown,
  contextFromSnapshot,
  replyToMarkdown,
  type CopyMarkdownContext,
} from "../src/content/copy-markdown.js";
import type { ReviewSnapshot } from "../src/api.js";

const FILES = [
  { fileKey: "conn", path: "src/conn.py" },
  { fileKey: "sock", path: "src/sock.py" },
];

function prCtx(): CopyMarkdownContext {
  return {
    repo: { owner: "acme", name: "app" },
    isPR: true,
    headSha: "abc1234",
    filePath: (key: string) => FILES.find((f) => f.fileKey === key)?.path ?? null,
    hunkRange: (key: string, hash: string) =>
      key === "conn" && hash === "deadbeef" ? { start: 10, end: 20 } : null,
    descriptionLabel: "PR description",
  };
}

function localCtx(): CopyMarkdownContext {
  return { ...prCtx(), repo: null, isPR: false };
}

function para(html: string, citations: { target: string }[] = [], id = "b1"): Block {
  return { type: "paragraph", id, text: { standard: html }, citations };
}

describe("copy-markdown (#377)", () => {
  it("renders the title as a heading and the current depth level", () => {
    const md = cardToMarkdown(
      {
        title: "Retries",
        blocks: [
          {
            type: "paragraph",
            id: "b1",
            text: { simple: "Simple <code>x</code>.", standard: "Standard <em>y</em>.", deep: "Deep." },
            citations: [],
          },
        ],
      },
      "simple",
      prCtx(),
    );
    expect(md).toBe("## Retries\n\nSimple `x`.\n");
    const deep = cardToMarkdown(
      {
        title: "Retries",
        blocks: [
          {
            type: "paragraph",
            id: "b1",
            text: { standard: "Standard.", deep: "Deep <strong>z</strong>." },
            citations: [],
          },
        ],
      },
      "deep",
      prCtx(),
    );
    expect(deep).toBe("## Retries\n\nDeep **z**.\n");
  });

  it("falls back to the shared title rule when the reply carried none", () => {
    const md = cardToMarkdown(
      { title: null, blocks: [para("First words here then more text to fill the fallback")] },
      "standard",
      prCtx(),
    );
    expect(md.startsWith("## ")).toBe(true);
    expect(md).not.toContain("## \n");
  });

  it("renders a persona variant's own blocks", () => {
    const variantBlocks: Block[] = [para("Persona take.")];
    const md = cardToMarkdown({ title: "Guide title", blocks: variantBlocks }, "standard", prCtx());
    expect(md).toBe("## Guide title\n\nPersona take.\n");
  });

  it("renders lists with per-item citations and ordered start numbers", () => {
    const md = blocksToMarkdown(
      [
        {
          type: "list",
          id: "b1",
          ordered: true,
          start: 3,
          items: [
            { html: "First <code>a</code>", citations: [{ target: "diff:conn:10-12" }] },
            { html: "Second", citations: [] },
          ],
          citations: [{ target: "diff:conn:10-12" }, { target: "diff:sock:5" }],
        },
      ],
      "standard",
      prCtx(),
    );
    expect(md).toContain("3. First `a` ([conn.py:10–12](https://github.com/acme/app/blob/abc1234/src/conn.py#L10-L12))");
    expect(md).toContain("4. Second ([sock.py:5](https://github.com/acme/app/blob/abc1234/src/sock.py#L5))");
    // The covered block-level citation is not repeated; the uncovered one lands on the last item.
    expect(md.match(/conn\.py:10–12/g)?.length).toBe(1);
  });

  it("renders tables as pipe Markdown", () => {
    const md = blocksToMarkdown(
      [
        {
          type: "table",
          id: "b1",
          html: "<table><tr><th>Name</th><th>When</th></tr><tr><td><code>retry</code></td><td>on <em>fail</em></td></tr></table>",
          citations: [],
        },
      ],
      "standard",
      prCtx(),
    );
    expect(md).toBe("| Name | When |\n| --- | --- |\n| `retry` | on *fail* |\n");
  });

  it("renders asides as quoted sections with their label", () => {
    const md = blocksToMarkdown(
      [
        {
          type: "aside",
          id: "b1",
          kind: "Example",
          inner: [para("Do <strong>this</strong>.", [{ target: "diff:conn:10" }], "b1-b1")],
          citations: [{ target: "diff:conn:10" }],
        },
      ],
      "standard",
      localCtx(),
    );
    expect(md).toBe("> **Example**\n> Do **this**. (conn.py:10)\n");
  });

  it("renders diagrams as fenced d2 source with caption and code citations", () => {
    const md = blocksToMarkdown(
      [
        {
          type: "diagram",
          id: "b1",
          source: "a -> b: read",
          caption: "The <em>flow</em>",
          citations: [{ target: "code:src/sock.py:1-3" }],
        },
      ],
      "standard",
      localCtx(),
    );
    expect(md).toBe("```d2\na -> b: read\n```\n\nThe *flow*\n\n(sock.py:1–3)\n");
  });

  it("renders sub-headings as ### and code fences with language", () => {
    const md = blocksToMarkdown(
      [
        { type: "heading", id: "b1", html: "Why <code>this</code>", citations: [] },
        { type: "code", id: "b2", language: "python", code: "x = 1", citations: [] },
      ],
      "standard",
      prCtx(),
    );
    expect(md).toBe("### Why `this`\n\n```python\nx = 1\n```\n");
  });

  it("renders concept, card and page links as their visible label", () => {
    const md = blocksToMarkdown(
      [
        para(
          'See <a class="cx" data-link="concept:idempotency">retry safely</a> and <a class="cx" data-node="card:central#b2">the rule</a> on <a class="cx" data-link="page:glossary">glossary</a>.',
        ),
      ],
      "standard",
      prCtx(),
    );
    expect(md).toBe("See retry safely and the rule on glossary.\n");
    expect(md).not.toContain("[[");
  });

  it("cites PR reviews as head-commit permalinks", () => {
    const md = blocksToMarkdown(
      [para("Mutates state.", [{ target: "diff:conn:10-20" }])],
      "standard",
      prCtx(),
    );
    expect(md).toBe(
      "Mutates state. ([conn.py:10–20](https://github.com/acme/app/blob/abc1234/src/conn.py#L10-L20))\n",
    );
  });

  it("cites hunk ids by their new-side range with a permalink", () => {
    const md = blocksToMarkdown(
      [para("A hunk.", [{ target: "h:conn:deadbeef" }])],
      "standard",
      prCtx(),
    );
    expect(md).toBe(
      "A hunk. ([conn.py:10–20](https://github.com/acme/app/blob/abc1234/src/conn.py#L10-L20))\n",
    );
  });

  it("dedupes citations rendering to the same range and comma-separates them", () => {
    const md = blocksToMarkdown(
      [
        para("Mutates state.", [
          { target: "diff:conn:10-20" },
          { target: "h:conn:deadbeef" },
          { target: "code:src/sock.py:1" },
        ]),
      ],
      "standard",
      localCtx(),
    );
    expect(md).toBe("Mutates state. (conn.py:10–20, sock.py:1)\n");
  });

  it("renders description and document citations as plain text", () => {
    const md = blocksToMarkdown(
      [para("Context.", [{ target: "desc:d-sync" }, { target: "doc:p3" }])],
      "standard",
      prCtx(),
    );
    expect(md).toBe("Context. (PR description, Document p3)\n");
  });

  it("renders finding and comment links without raw ids", () => {
    const md = blocksToMarkdown(
      [
        { type: "finding-link", id: "b1", pageId: "f1", citations: [] },
        { type: "comment-link", id: "b2", diffRef: "diff:conn:42", threadId: "a1", citations: [] },
      ],
      "standard",
      prCtx(),
      {
        findPage: (id: string) =>
          id === "f1" ? { title: "Leak", confidence: "high", summary: "drips" } : null,
      },
    );
    expect(md).toContain("**Agent finding · high confidence:** Leak — drips");
    expect(md).toContain(
      "Suggested review comment on [conn.py:42](https://github.com/acme/app/blob/abc1234/src/conn.py#L42)",
    );
    expect(md).not.toContain("[[");
  });

  it("renders follow-ups as a labelled list", () => {
    const md = blocksToMarkdown(
      [
        {
          type: "follow-up",
          id: "b1",
          items: [{ label: "Why not here?" }, { label: "More", ask: "Tell me more" }],
          citations: [],
        },
      ],
      "standard",
      prCtx(),
    );
    expect(md).toBe("**Follow up:**\n- Why not here?\n- More — Tell me more\n");
  });

  it("renders a card's Since answers and Updated-since addenda", () => {
    const md = cardToMarkdown(
      {
        title: "Guide",
        blocks: [para("Main.")],
        answers: [
          { kind: "thread", label: "Thread t-1", excerpt: "is this right?" },
          { kind: "conversation", label: "PR conversation", excerpt: "ship it", url: "https://example.com/c/1" },
        ],
        addenda: [
          {
            id: "add-v2-0",
            version: 2,
            baseline: { kind: "version", version: 1 },
            at: 0,
            blocks: [para("Updated since v1: alpha returns 111 now.", [{ target: "diff:conn:3" }])],
            answers: [{ kind: "commit", label: "abc1234 subject", excerpt: "fix" }],
          },
        ],
      },
      "standard",
      prCtx(),
      { formatDate: () => "4 Nov" },
    );
    expect(md).toBe(
      "## Guide\n\n" +
        "Main.\n\n" +
        'Answers: Thread t-1 — "is this right?" · [PR conversation — "ship it"](https://example.com/c/1)\n\n' +
        "### Updated since v1 · 4 Nov\n\n" +
        "alpha returns 111 now. " +
        "([conn.py:3](https://github.com/acme/app/blob/abc1234/src/conn.py#L3))\n\n" +
        'Answers: abc1234 subject — "fix"\n',
    );
    expect(md).not.toContain("[[");
  });

  it("renders a thread answer under its question", () => {
    const md = replyToMarkdown(
      { question: "Why retry?", kind: "ask", blocks: [para("Because <code>x</code>.", [{ target: "diff:sock:7" }])] },
      "standard",
      localCtx(),
    );
    expect(md).toBe("## Why retry?\n\nBecause `x`. (sock.py:7)\n");
  });

  it("builds the context from a snapshot", () => {
    const snapshot = {
      review: { prNumber: 12 },
      version: { headSha: "ff00ff" },
      files: [{ fileKey: "conn", path: "src/conn.py", hunks: [] }],
    } as unknown as ReviewSnapshot;
    const ctx = contextFromSnapshot(snapshot, { owner: "acme", name: "app" });
    expect(ctx.isPR).toBe(true);
    const md = blocksToMarkdown([para("T.", [{ target: "diff:conn:3" }])], "standard" as DepthLevel, ctx);
    expect(md).toContain("https://github.com/acme/app/blob/ff00ff/src/conn.py#L3");
    const plain = contextFromSnapshot(snapshot, null);
    expect(plain.isPR).toBe(false);
  });

  it("never emits link tokens or raw ids for the covered block kinds", () => {
    const blocks: Block[] = [
      para('A <a class="cx" data-link="concept:x|Ex why">why</a>.', [{ target: "diff:conn:1-2" }]),
      { type: "heading", id: "b2", html: "Head", citations: [] },
      {
        type: "list",
        id: "b3",
        ordered: false,
        items: [{ html: "Item", citations: [{ target: "code:src/sock.py:9" }] }],
        citations: [],
      },
      {
        type: "table",
        id: "b4",
        html: "<table><tr><th>H</th></tr><tr><td>V</td></tr></table>",
        citations: [],
      },
      { type: "code", id: "b5", code: "y", citations: [] },
      { type: "diagram", id: "b6", source: "x -> y", citations: [] },
      { type: "aside", id: "b7", kind: "Underlying principle", inner: [para("P.")], citations: [] },
    ];
    for (const ctx of [prCtx(), localCtx()]) {
      const md = cardToMarkdown({ title: "T", blocks }, "standard", ctx);
      expect(md).not.toContain("[[");
      expect(md).not.toContain("]]");
      expect(md).not.toMatch(/diff:|concept:|card:|page:|desc:|doc:/);
    }
  });
});
