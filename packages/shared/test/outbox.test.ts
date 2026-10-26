import { describe, expect, test } from "vitest";
import type { Reply, ReviewSnapshot, Thread } from "../src/index.js";
import { buildOutboxExportMarkdown, isInOutbox, orderedOutboxThreads, outboxThreads } from "../src/index.js";

function commentReply(who: "you" | "agent", text: string, opts?: { suggested?: boolean }): Reply {
  return {
    id: `r_${who}_${Math.random().toString(36).slice(2, 6)}`,
    kind: "comment",
    who,
    question: null,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...(opts?.suggested ? { suggested: true } : {}),
  };
}

function agentReply(question: string): Reply {
  return {
    id: `r_ask_${Math.random().toString(36).slice(2, 6)}`,
    kind: "ask",
    who: "agent",
    question,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: "answer" }, citations: [] }],
    level: "standard",
    revision: 1,
    undoStack: [],
  };
}

function thread(partial: Partial<Thread> & { id: string }): Thread {
  return {
    type: "thread",
    anchor: { host: { kind: "block", blockId: "c1#b1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    pinned: false,
    replies: [commentReply("you", "note")],
    post: true,
    ...partial,
  } as Thread;
}

function snapshot(annotations: Thread[]): ReviewSnapshot {
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
  test("set is marked comments not yet posted, excluding agent-only threads", () => {
    const snap = snapshot([
      thread({ id: "a" }),
      thread({ id: "b", post: false }),
      thread({ id: "c", postedAt: 1 }),
      thread({ id: "d", replies: [agentReply("q")] }),
    ]);
    expect(outboxThreads(snap).map((t) => t.id)).toEqual(["a"]);
    expect(isInOutbox(thread({ id: "x" }))).toBe(true);
    expect(isInOutbox(thread({ id: "x", postedAt: 5 }))).toBe(false);
  });

  test("orders diff, then description, then guide; draft wins; AI tagged", () => {
    const snap = snapshot([
      thread({ id: "guide", replies: [commentReply("you", "guide note")] }),
      thread({
        id: "desc",
        anchor: { host: { kind: "description", paragraphId: "p1" }, quotedText: "desc quote", prefix: "", suffix: "", position: 0, version: 1 },
        replies: [commentReply("you", "desc note")],
      }),
      thread({
        id: "diff2",
        anchor: { host: { kind: "diff-line", fileKey: "fk2", line: 3 }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
        replies: [commentReply("agent", "suggested text", { suggested: true })],
        draft: "edited draft",
      }),
      thread({
        id: "diff1",
        anchor: { host: { kind: "diff-line", fileKey: "fk1", line: 9 }, quotedText: "quoted code", prefix: "", suffix: "", position: 0, version: 1 },
        replies: [commentReply("you", "diff note"), commentReply("you", "a reply that must not export")],
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
          replies: [commentReply("you", "later note")],
        }),
        thread({
          id: "filetab",
          anchor: { host: { kind: "code", path: "src/app.ts", commit: "abc1234", line: 2 }, quotedText: "return 1", prefix: "", suffix: "", position: 0, version: 1 },
          replies: [commentReply("you", "file note")],
        }),
        thread({
          id: "earlier",
          anchor: { host: { kind: "block", blockId: "document#p2" }, quotedText: "First.", prefix: "", suffix: "", position: 0, version: 1 },
          replies: [commentReply("you", "earlier note")],
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
