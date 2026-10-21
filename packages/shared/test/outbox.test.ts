import { describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "../src/index.js";
import { buildOutboxExportMarkdown, isInOutbox, orderedOutboxThreads, outboxThreads } from "../src/index.js";

function thread(partial: Partial<Annotation> & { id: string }): Annotation {
  return {
    type: "comment",
    anchor: { host: { kind: "block", blockId: "c1#b1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    pinned: false,
    messages: [{ who: "you", text: "note" }],
    post: true,
    ...partial,
  } as Annotation;
}

function snapshot(annotations: Annotation[]): ReviewSnapshot {
  return {
    review: { id: "r1", repoId: "repo", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [
      { fileKey: "fk1", path: "src/app.py", category: "source", hunks: [] },
      { fileKey: "fk2", path: "src/util.py", category: "source", hunks: [] },
    ],
    ingest: { status: "ready" },
    pages: [
      {
        id: "root", kind: "root", title: "Guide title",
        cards: [{ id: "c1", title: "Card One", collapsed: false, blocks: [{ id: "b1" } as never] }],
      } as never,
    ],
    annotations,
    hunkStates: [],
    fileStates: [],
    viewPrefs: {} as never,
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as ReviewSnapshot;
}

describe("outbox", () => {
  test("set is marked comments not yet posted, excluding conversations", () => {
    const snap = snapshot([
      thread({ id: "a" }),
      thread({ id: "b", post: false }),
      thread({ id: "c", postedAt: 1 }),
      thread({ id: "d", type: "conversation" as never }),
    ]);
    expect(outboxThreads(snap).map((t) => t.id)).toEqual(["a"]);
    expect(isInOutbox(thread({ id: "x" }))).toBe(true);
    expect(isInOutbox(thread({ id: "x", postedAt: 5 }))).toBe(false);
  });

  test("orders diff, then description, then guide; draft wins; AI tagged", () => {
    const snap = snapshot([
      thread({ id: "guide", messages: [{ who: "you", text: "guide note" }] }),
      thread({
        id: "desc",
        anchor: { host: { kind: "description", paragraphId: "p1" }, quotedText: "desc quote", prefix: "", suffix: "", position: 0, version: 1 },
        messages: [{ who: "you", text: "desc note" }],
      }),
      thread({
        id: "diff2",
        anchor: { host: { kind: "diff-line", fileKey: "fk2", line: 3 }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
        messages: [{ who: "ai", text: "suggested text", suggested: true }],
        draft: "edited draft",
      }),
      thread({
        id: "diff1",
        anchor: { host: { kind: "diff-line", fileKey: "fk1", line: 9 }, quotedText: "quoted code", prefix: "", suffix: "", position: 0, version: 1 },
        messages: [{ who: "you", text: "diff note" }, { who: "you", text: "a reply that must not export" }],
      }),
    ]);
    expect(orderedOutboxThreads(snap).map((t) => t.id)).toEqual(["diff1", "diff2", "desc", "guide"]);
    const md = buildOutboxExportMarkdown(snap, { title: "My review" });
    expect(md).toBe(
      [
        "# Comments on My review",
        "",
        "## src/app.py:9",
        "",
        "> quoted code",
        "",
        "diff note",
        "",
        "## src/util.py:3 · AI-suggested",
        "",
        "edited draft",
        "",
        "## Commits",
        "",
        "> desc quote",
        "",
        "desc note",
        "",
        "## Guide title › Card One",
        "",
        "guide note",
        "",
      ].join("\n"),
    );
    expect(md).not.toContain("a reply that must not export");
  });

  test("document comments name their block and order as the guide slot (#222)", () => {
    const snap = snapshot([]);
    const docSnap = {
      ...snap,
      document: {
        title: "Design note",
        markdown: "# Design note\n\nFirst.\n\nSecond.\n",
        blocks: [
          { id: "p1", kind: "heading", level: 1, block: { type: "paragraph", id: "p1" } },
          { id: "p2", kind: "content", block: { type: "paragraph", id: "p2" } },
          { id: "p3", kind: "content", block: { type: "paragraph", id: "p3" } },
        ],
      },
      contextRepos: [],
      pages: [],
    } as unknown as ReviewSnapshot;
    const withThreads = {
      ...docSnap,
      annotations: [
        thread({
          id: "later",
          anchor: { host: { kind: "block", blockId: "document#p3" }, quotedText: "Second.", prefix: "", suffix: "", position: 0, version: 1 },
          messages: [{ who: "you", text: "later note" }],
        }),
        thread({
          id: "filetab",
          anchor: { host: { kind: "code", path: "src/app.ts", commit: "abc1234", line: 2 }, quotedText: "return 1", prefix: "", suffix: "", position: 0, version: 1 },
          messages: [{ who: "you", text: "file note" }],
        }),
        thread({
          id: "earlier",
          anchor: { host: { kind: "block", blockId: "document#p2" }, quotedText: "First.", prefix: "", suffix: "", position: 0, version: 1 },
          messages: [{ who: "you", text: "earlier note" }],
        }),
      ],
    } as unknown as ReviewSnapshot;
    // Document blocks in document order (the guide slot), file-tab last.
    expect(orderedOutboxThreads(withThreads).map((t) => t.id)).toEqual(["earlier", "later", "filetab"]);
    const md = buildOutboxExportMarkdown(withThreads, { title: "Design note" });
    expect(md).toContain("## Design note › p2");
    expect(md).toContain("## Design note › p3");
    expect(md).toContain("## src/app.ts:2");
  });

  test("empty outbox exports just the heading", () => {
    expect(buildOutboxExportMarkdown(snapshot([]), { title: "T" })).toBe("# Comments on T\n");
  });
});
