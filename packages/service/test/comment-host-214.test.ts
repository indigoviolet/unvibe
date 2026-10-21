/**
 * Issue #214: a selection inside any comment card anchors to that
 * comment, and the Ask/Explain host block is the comment's text.
 */
import { describe, expect, it } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { buildAnchor } from "../src/comments/threads.js";
import { hostBlockText, l4Variables } from "../src/interaction/l4.js";
import { anchorSameHost } from "../src/pipeline/actions/explain-host.js";
import { createSnapshotLookup } from "../src/validate/snapshot.js";
import { validateAnchor } from "../src/validate/validate.js";

const GUIDE_TEXT = "Guide paragraph about unfolding headers.";
const QUESTION_TEXT = "Whether folded values that end in LF alone occur in real responses?";
const AI_TEXT = "This boundary test misses the bare-LF case entirely.";
const PERSON_TEXT = "I think the fast path needs a second look here.";

function comment(id: string, host: Annotation["anchor"]["host"], messages: Annotation["messages"]): Annotation {
  return {
    id,
    type: "comment",
    anchor: { host, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    pinned: false,
    messages,
    post: false,
  };
}

function snapshot(): ReviewSnapshot {
  return {
    review: { id: "rv_214", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [
      {
        fileKey: "conn",
        path: "src/conn.py",
        status: "modified",
        additions: 1,
        deletions: 0,
        hunks: [
          {
            contentHash: "h111",
            oldStart: 80,
            oldLines: 3,
            newStart: 80,
            newLines: 3,
            header: "@@ -80,3 +80,3 @@",
            lines: [{ kind: "ctx", text: "value = normalize(raw)", newLine: 82, oldLine: 82 }],
          },
        ],
      } as unknown as ReviewSnapshot["files"][number],
    ],
    pages: [
      {
        id: "root",
        kind: "root",
        title: "Guide",
        cards: [
          {
            id: "problem",
            title: "The problem",
            level: "standard",
            revision: 1,
            collapsed: false,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: GUIDE_TEXT }, citations: [] }],
            secondOpinions: [],
          } as unknown as ReviewSnapshot["pages"][number]["cards"][number],
        ],
      } as unknown as ReviewSnapshot["pages"][number],
    ],
    annotations: [
      comment("ann_q", { kind: "block", blockId: "problem#b1" }, [
        { who: "ai", text: QUESTION_TEXT, suggested: true, question: true },
      ]),
      comment("ann_ai", { kind: "diff-line", fileKey: "conn", line: 82 }, [
        { who: "ai", text: AI_TEXT, suggested: true },
      ]),
      comment("ann_you", { kind: "block", blockId: "problem#b1" }, [{ who: "you", text: PERSON_TEXT }]),
    ],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  } as unknown as ReviewSnapshot;
}

function anchorFor(commentId: string, quote: string): Annotation["anchor"] {
  return {
    host: { kind: "comment", commentId },
    quotedText: quote,
    prefix: "",
    suffix: "",
    position: 0,
    version: 1,
  };
}

describe("comment host block (#214)", () => {
  it("host block is the suggested-question text, not the guide paragraph", () => {
    const snap = snapshot();
    const anchor = anchorFor("ann_q", "folded values");
    expect(hostBlockText(snap, anchor)).toBe(QUESTION_TEXT);
    expect(hostBlockText(snap, anchor)).not.toContain(GUIDE_TEXT);
    const vars = l4Variables(snap, anchor, { message: "Explain this." });
    expect((vars.anchor as { block: string }).block).toBe(QUESTION_TEXT);
    expect((vars.anchor as { quote: string }).quote).toBe("folded values");
  });

  it("host block is the comment text for AI and person comments, in guide and diff", () => {
    const snap = snapshot();
    expect(hostBlockText(snap, anchorFor("ann_ai", "bare-LF case"))).toBe(AI_TEXT);
    expect(hostBlockText(snap, anchorFor("ann_you", "fast path"))).toBe(PERSON_TEXT);
  });

  it("buildAnchor validates the comment and derives context from its text", () => {
    const snap = snapshot();
    const built = buildAnchor(snap, { where: "comment", commentId: "ann_q" }, "folded values");
    expect(built.host).toEqual({ kind: "comment", commentId: "ann_q" });
    expect(built.quotedText).toBe("folded values");
    expect(() => buildAnchor(snap, { where: "comment", commentId: "ann_nope" }, "x")).toThrow(/unknown comment/);
  });

  it("anchor validation checks the quote against the comment text", () => {
    const snap = snapshot();
    const lookup = createSnapshotLookup(snap);
    expect(lookup.hostText("ann:ann_q")).toBe(QUESTION_TEXT);
    expect(validateAnchor("folded values", "ann:ann_q", lookup).ok).toBe(true);
    expect(validateAnchor("guide paragraph", "ann:ann_q", lookup).ok).toBe(false);
  });

  it("comment hosts compare by comment id for reuse", () => {
    const a = anchorFor("ann_q", "x");
    const b = anchorFor("ann_q", "y");
    const c = anchorFor("ann_ai", "x");
    expect(anchorSameHost(a, b)).toBe(true);
    expect(anchorSameHost(a, c)).toBe(false);
  });
});
