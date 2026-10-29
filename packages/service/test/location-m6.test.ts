/**
 * M6 location computation (PRD 4.8, 4.12): diff-line, guide-block via
 * first `diff:` citation, general fallback; multi-line ranges,
 * outside-diff fallback with a note, deleted-side lines, renames.
 */
import { describe, expect, it } from "vitest";
import type { Thread, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import {
  locatePendingThreads,
  locateThread,
  locateThreadWithText,
} from "../src/comments/location.js";
import { threadPostText } from "../src/comments/threads.js";
import { BASE_SHA, deletedFile, HEAD_SHA, renamedFile, sourceFile } from "./m6-helpers.js";

function snapshotWith(annotations: Thread[], files = [sourceFile()], pages: ReviewSnapshot["pages"] = []): ReviewSnapshot {
  return {
    review: { id: "rv", repoId: "rp", branch: "b", prNumber: 7, versions: [], currentVersion: 1, createdAt: 1 },
    version: { n: 1, headSha: HEAD_SHA, mergeBaseSha: BASE_SHA, baseRef: "main", fetchedAt: 1, idMapping: {} },
    files,
    pages,
    annotations,
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
}

function diffThread(fileKey: string, line: number, text = "body", extra: Partial<Thread> = {}): Thread {
  return {
    id: `t-${fileKey}-${line}`,
    type: "thread",
    anchor: { host: { kind: "diff-line", fileKey, line }, quotedText: "", prefix: "", suffix: "", position: line, version: 1 },
    open: true,
    replies: [{
      id: "ans_t1",
      kind: "comment",
      who: "you",
      question: null,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
      level: "standard",
      revision: 1,
      undoStack: [],
    }],
    post: true,
    ...extra,
    // `extra` is a Partial, so its `pinned` may be absent; Thread requires it.
    pinned: extra.pinned ?? false,
  };
}

describe("locateThread", () => {
  it("maps a diff-line add to RIGHT", () => {
    const snap = snapshotWith([diffThread("a-py", 2)]);
    const loc = locateThread(snap, snap.annotations[0] as Thread);
    expect(loc).toEqual({ kind: "inline", path: "a.py", line: 2, side: "RIGHT" });
  });

  it("maps a deleted-side line to LEFT", () => {
    const snap = snapshotWith(
      [{ ...diffThread("d-py", 2), anchor: { host: { kind: "diff-line", fileKey: "d-py", line: 2, side: "LEFT" }, quotedText: "", prefix: "", suffix: "", position: 2, version: 1 } }],
      [deletedFile()],
    );
    const loc = locateThread(snap, snap.annotations[0] as Thread);
    expect(loc).toEqual({ kind: "inline", path: "d.py", line: 2, side: "LEFT" });
  });

  it("handles multi-line ranges with start_line/start_side", () => {
    const t = diffThread("a-py", 1, "range");
    t.anchor.host = { kind: "diff-line", fileKey: "a-py", line: 1, endLine: 3 };
    const snap = snapshotWith([t]);
    const loc = locateThread(snap, t);
    expect(loc).toEqual({ kind: "inline", path: "a.py", line: 3, side: "RIGHT", startLine: 1, startSide: "RIGHT" });
  });

  it("falls back to the review body outside the diff", () => {
    const snap = snapshotWith([diffThread("a-py", 500)]);
    const loc = locateThread(snap, snap.annotations[0] as Thread);
    expect(loc.kind).toBe("general");
  });

  it("falls back to the nearest commentable line with a note", () => {
    // Old-side context line (old 2 -> new 12): no exact LEFT/RIGHT match,
    // but inside the old hunk range, so we move + say so.
    const file: ReviewFile = {
      fileKey: "m-py",
      path: "m.py",
      category: "source" as const,
      hunks: [
        {
          contentHash: "hm",
          header: "@@ -1,2 +10,3 @@",
          newStart: 10,
          newEnd: 12,
          oldStart: 1,
          oldEnd: 2,
          added: 1,
          removed: 0,
          lines: [
            { kind: "ctx", oldLine: 1, newLine: 10, text: "a" },
            { kind: "add", newLine: 11, text: "b" },
            { kind: "ctx", oldLine: 2, newLine: 12, text: "c" },
          ],
        },
      ],
    };
    const t: Thread = {
      ...diffThread("m-py", 2, "old ctx"),
      anchor: { host: { kind: "diff-line", fileKey: "m-py", line: 2, side: "LEFT" }, quotedText: "", prefix: "", suffix: "", position: 2, version: 1 },
    };
    const snap = snapshotWith([t], [file]);
    const located = locateThreadWithText(snap, t);
    expect(located.location.kind).toBe("inline");
    if (located.location.kind === "inline") {
      expect(located.location.fallbackNote).toMatch(/nearest line it accepts/);
      expect(located.text.startsWith("GitHub")).toBe(true);
    }
  });

  it("uses the new path for renames", () => {
    const snap = snapshotWith([diffThread("new-py", 2)], [renamedFile()]);
    const loc = locateThread(snap, snap.annotations[0] as Thread);
    expect(loc).toEqual({ kind: "inline", path: "new.py", line: 2, side: "RIGHT" });
  });

  it("resolves guide blocks through the first diff citation", () => {
    const pages: ReviewSnapshot["pages"] = [
      {
        id: "p1",
        kind: "root",
        title: "G",
        cards: [
          {
            id: "c1",
            pageId: "p1",
            title: "C",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [
              { type: "paragraph", id: "b1", text: { standard: "see code" }, citations: [{ target: `diff:a-py:3@${HEAD_SHA}` }] },
            ],
            undoStack: [],
          },
        ],
      },
    ];
    const t: Thread = {
      id: "t-guide",
      type: "thread",
      anchor: { host: { kind: "block", blockId: "b1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
      open: false,
      pinned: false,
      replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "guide q" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }],
      post: true,
    };
    const snap = snapshotWith([t], [sourceFile()], pages);
    expect(locateThread(snap, t)).toEqual({ kind: "inline", path: "a.py", line: 3, side: "RIGHT" });
  });

  it("sends blocks without diff citations + description threads to the body", () => {
    const pages: ReviewSnapshot["pages"] = [
      {
        id: "p1",
        kind: "root",
        title: "G",
        cards: [
          {
            id: "c1",
            pageId: "p1",
            title: "C",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b9", text: { standard: "no cites" }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ];
    const guide: Thread = {
      id: "t-g",
      type: "thread",
      anchor: { host: { kind: "block", blockId: "b9" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
      open: false,
      pinned: false,
      replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "g" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }],
      post: true,
    };
    const desc: Thread = {
      id: "t-d",
      type: "thread",
      anchor: { host: { kind: "description", paragraphId: "d-p1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
      open: true,
      pinned: false,
      replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "d" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }],
      post: true,
    };
    const snap = snapshotWith([guide, desc], [sourceFile()], pages);
    expect(locateThread(snap, guide).kind).toBe("general");
    expect(locateThread(snap, desc).kind).toBe("general");
  });

  it("sends a file-tab comment to the review body with a permalink (#81)", () => {
    const t: Thread = {
      id: "t-code",
      type: "thread",
      anchor: {
        host: { kind: "code", path: "helper.py", commit: HEAD_SHA, line: 2, endLine: 3 },
        quotedText: "beta = 2\ngamma = 3",
        prefix: "",
        suffix: "",
        position: 2,
        version: 1,
      },
      open: true,
      pinned: false,
      replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "Is beta still the right default?" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }],
      post: true,
    };
    const snap = snapshotWith([t]);
    expect(locateThread(snap, t).kind).toBe("general");
    const withRepo = locateThreadWithText(snap, t, { owner: "octo", name: "hello" });
    expect(withRepo.text).toBe(
      `https://github.com/octo/hello/blob/${HEAD_SHA}/helper.py#L2-L3\n\n> beta = 2\n> gamma = 3\n\nIs beta still the right default?`,
    );
    // No repo to link to: the plain text stands alone. An empty comment
    // stays empty, so Submit still refuses it instead of posting a bare link.
    expect(locateThreadWithText(snap, t).text).toBe("Is beta still the right default?");
    const empty: Thread = { ...t, id: "t-code-empty", replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }] };
    expect(locateThreadWithText(snap, empty, { owner: "octo", name: "hello" }).text).toBe("");
    // Single-line citations link #Lx, not #Lx-Lx.
    const single: Thread = {
      ...t,
      id: "t-code-1",
      anchor: { ...t.anchor, host: { kind: "code", path: "helper.py", commit: HEAD_SHA, line: 2 } },
    };
    expect(locateThreadWithText(snap, single, { owner: "octo", name: "hello" }).text).toContain(`/helper.py#L2\n`);
  });

  it("skips unmarked + already-posted threads in pending", () => {
    const a = diffThread("a-py", 1, "one");
    const b = { ...diffThread("a-py", 2, "two"), post: false };
    const c = { ...diffThread("a-py", 3, "three"), postedAt: 5, postedUrl: "u" };
    const snap = snapshotWith([a, b, c]);
    expect(locatePendingThreads(snap).map((p) => p.thread.id)).toEqual([a.id]);
  });

  it("prefers draft, then you, then suggested text", () => {
    const mk = (who: "you" | "agent", text: string, suggested = false): Thread["replies"][number] => ({
      id: `ans_${who}_${text}`,
      kind: "comment",
      who,
      question: null,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
      level: "standard",
      revision: 1,
      undoStack: [],
      ...(suggested ? { suggested: true } : {}),
    });
    const base: Thread = {
      id: "t",
      type: "thread",
      anchor: { host: { kind: "description", paragraphId: "d-p1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
      open: true,
      pinned: false,
      replies: [mk("agent", "suggested", true), mk("you", "mine")],
      post: true,
    };
    expect(threadPostText(base)).toBe("mine");
    expect(threadPostText({ ...base, draft: "d" })).toBe("d");
    expect(threadPostText({ ...base, replies: [{ id: "ans_t1", kind: "comment", who: "agent", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "s" }, citations: [] }], level: "standard", revision: 1, undoStack: [], suggested: true }] })).toBe("s");
  });
});
