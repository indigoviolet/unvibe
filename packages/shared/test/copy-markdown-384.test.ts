/**
 * Whole-guide copy (issue #384): the review title as `#`, each main
 * guide card in guide order as `##` plus its Guide-version prose at
 * that card's shown depth. Citations render exactly as #377's card copy
 * (permalinks on PR reviews, `path:lines` otherwise); diagrams become
 * placeholders; code blocks, code fences inside list items, finding and
 * comment links, follow-ups, answers and addenda are left out; the
 * output never contains `[[…]]` tokens. Card copy (#377) is unchanged —
 * the last test guards its output here too.
 */
import { describe, expect, it } from "vitest";
import type { Block } from "../src/entities.js";
import {
  blocksToMarkdown,
  cardToMarkdown,
  guideToMarkdown,
  type CopyMarkdownContext,
  type GuideCardInput,
} from "../src/content/copy-markdown.js";

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

function card(title: string | null, blocks: Block[], level: "simple" | "standard" | "deep" = "standard"): GuideCardInput {
  return { title, blocks, level };
}

describe("guide copy (#384)", () => {
  it("renders the review title as # and each card in order as ##", () => {
    const md = guideToMarkdown(
      "Fix the retry path",
      [card("First", [para("One.")]), card("Second", [para("Two.")]), card("Third", [para("Three.")])],
      prCtx(),
    );
    expect(md).toBe("# Fix the retry path\n\n## First\n\nOne.\n\n## Second\n\nTwo.\n\n## Third\n\nThree.\n");
  });

  it("renders each card at its own shown depth", () => {
    const blocks: Block[] = [
      {
        type: "paragraph",
        id: "b1",
        text: { simple: "Simple.", standard: "Standard.", deep: "Deep." },
        citations: [],
      },
    ];
    const md = guideToMarkdown(
      "Title",
      [card("A", blocks, "simple"), card("B", blocks, "deep")],
      prCtx(),
    );
    expect(md).toBe("# Title\n\n## A\n\nSimple.\n\n## B\n\nDeep.\n");
  });

  it("leaves out code blocks, finding/comment links and follow-ups", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("Mixed", [
          para("Kept."),
          { type: "code", id: "b2", language: "python", code: "x = 1", citations: [] },
          { type: "finding-link", id: "b3", pageId: "f1", citations: [] },
          { type: "comment-link", id: "b4", diffRef: "diff:conn:42", threadId: "a1", citations: [] },
          { type: "follow-up", id: "b5", items: [{ label: "Check", ask: "Why?" }], citations: [] },
          para("Also kept."),
        ]),
      ],
      prCtx(),
      { findPage: () => ({ title: "Finding", confidence: "high", summary: "A finding" }) },
    );
    expect(md).toBe("# Title\n\n## Mixed\n\nKept.\n\nAlso kept.\n");
    expect(md).not.toContain("```");
    expect(md).not.toContain("Agent finding");
    expect(md).not.toContain("Suggested review comment");
    expect(md).not.toContain("Follow up");
  });

  it("renders no heading for a card left with no prose", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("Prose", [para("Kept.")]),
        card("Code only", [{ type: "code", id: "b1", code: "x", citations: [] }]),
      ],
      prCtx(),
    );
    expect(md).toBe("# Title\n\n## Prose\n\nKept.\n");
    expect(md).not.toContain("Code only");
  });

  it("renders diagrams as placeholders with and without a caption", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("Caps", [
          { type: "diagram", id: "b1", source: "a -> b", caption: "The <em>flow</em>", citations: [] },
          { type: "diagram", id: "b2", source: "x -> y", citations: [] },
        ]),
      ],
      prCtx(),
    );
    expect(md).toBe("# Title\n\n## Caps\n\n_[Diagram: The *flow*]_\n\n_[Diagram]_\n");
    expect(md).not.toContain("```");
  });

  it("keeps citations on every rendered block including the diagram placeholder", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("Cited", [
          para("Mutates state.", [{ target: "diff:conn:10-20" }]),
          { type: "diagram", id: "b2", source: "a -> b", caption: "Flow", citations: [{ target: "diff:sock:5" }] },
        ]),
      ],
      prCtx(),
    );
    expect(md).toContain(
      "Mutates state. ([conn.py:10–20](https://github.com/acme/app/blob/abc1234/src/conn.py#L10-L20))",
    );
    expect(md).toContain(
      "_[Diagram: Flow]_ ([sock.py:5](https://github.com/acme/app/blob/abc1234/src/sock.py#L5))",
    );
  });

  it("renders plain path:lines citations on local reviews", () => {
    const md = guideToMarkdown("Title", [card("C", [para("Mutates state.", [{ target: "diff:conn:10-20" }])])], localCtx());
    expect(md).toBe("# Title\n\n## C\n\nMutates state. (conn.py:10–20)\n");
    expect(md).not.toContain("github.com");
  });

  it("renders no [[ tokens", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("Links", [
          para('See <a class="cx" data-link="concept:idempotency">retry safely</a>.', [
            { target: "diff:conn:10" },
          ]),
        ]),
      ],
      prCtx(),
    );
    expect(md).not.toContain("[[");
    expect(md).toContain("See retry safely.");
  });

  it("strips code fences embedded in list items in guide mode", () => {
    const blocks: Block[] = [
      {
        type: "list",
        id: "b1",
        items: [{ html: 'Run it<pre><code class="language-sh">make test</code></pre>', citations: [] }],
        citations: [],
      },
    ];
    const guide = guideToMarkdown("Title", [card("C", blocks)], prCtx());
    expect(guide).toBe("# Title\n\n## C\n\n- Run it\n");
    expect(guide).not.toContain("```");
    // Card copy (#377) keeps the fence: the default is unchanged.
    const cardMd = blocksToMarkdown(blocks, "standard", prCtx());
    expect(cardMd).toContain("```sh");
    expect(cardMd).toContain("make test");
  });

  it("strips code inside asides in guide mode", () => {
    const md = guideToMarkdown(
      "Title",
      [
        card("C", [
          {
            type: "aside",
            id: "b1",
            kind: "Example",
            inner: [
              para("Do this."),
              { type: "code", id: "b1-b2", language: "python", code: "x = 1", citations: [] },
            ],
            citations: [],
          },
        ]),
      ],
      prCtx(),
    );
    expect(md).toBe("# Title\n\n## C\n\n> **Example**\n> Do this.\n");
    expect(md).not.toContain("```");
  });

  it("card copy (#377) output stays exactly the same", () => {
    const md = cardToMarkdown(
      {
        title: "Retries",
        blocks: [
          { type: "heading", id: "b0", html: "Why", citations: [] },
          { type: "code", id: "b1", language: "python", code: "x = 1", citations: [] },
          { type: "diagram", id: "b2", source: "a -> b", caption: "Flow", citations: [] },
          { type: "finding-link", id: "b3", pageId: "f1", citations: [] },
          { type: "follow-up", id: "b4", items: [{ label: "Check" }], citations: [] },
        ],
      },
      "standard",
      prCtx(),
      { findPage: () => ({ title: "Finding" }) },
    );
    expect(md).toContain("```python\nx = 1\n```");
    expect(md).toContain("```d2\na -> b\n```");
    expect(md).toContain("*Flow*");
    expect(md).toContain("**Agent finding:** Finding");
    expect(md).toContain("**Follow up:**");
  });
});
