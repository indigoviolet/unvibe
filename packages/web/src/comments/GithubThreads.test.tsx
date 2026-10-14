/**
 * Existing GitHub comment grouping + outdated detection (issue #168):
 * replies nest under their ultimate root, orphans become roots, and a
 * line counts as outdated only when no current diff row carries it.
 */
import { describe, expect, it } from "vitest";
import type { ExistingReviewComment, ReviewFile } from "@unvibe/shared";
import { groupGithubComments, isOutdatedComment, resolveGithubThreads } from "./GithubThreads.js";

const made = (c: Partial<ExistingReviewComment> & { id: number }): ExistingReviewComment => ({
  body: "",
  bodyHtml: "",
  ...c,
});

const FILE: ReviewFile = {
  fileKey: "src-conn-py",
  path: "src/conn.py",
  category: "source",
  hunks: [
    {
      contentHash: "h1",
      header: "@@ -1,3 +1,4 @@",
      newStart: 1,
      newEnd: 4,
      oldStart: 1,
      oldEnd: 3,
      added: 2,
      removed: 1,
      lines: [
        { kind: "ctx", oldLine: 1, newLine: 1, text: "a" },
        { kind: "del", oldLine: 2, text: "b" },
        { kind: "add", newLine: 2, text: "c" },
        { kind: "add", newLine: 3, text: "d" },
        { kind: "ctx", oldLine: 3, newLine: 4, text: "e" },
      ],
    },
  ],
};

describe("groupGithubComments", () => {
  it("groups replies under their root in fetch order", () => {
    const threads = groupGithubComments([
      made({ id: 1, body: "root one" }),
      made({ id: 2, body: "root two" }),
      made({ id: 3, body: "reply", replyTo: 1 }),
      made({ id: 4, body: "nested reply", replyTo: 3 }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual([1, 2]);
    expect(threads[0].replies.map((r) => r.id)).toEqual([3, 4]);
    expect(threads[1].replies).toEqual([]);
  });

  it("treats replies to unknown parents as roots", () => {
    const threads = groupGithubComments([made({ id: 5, body: "orphan", replyTo: 99 })]);
    expect(threads.map((t) => t.root.id)).toEqual([5]);
  });
});

describe("isOutdatedComment", () => {
  it("matches current new-side and old-side rows", () => {
    expect(isOutdatedComment([FILE], made({ id: 1, path: "src/conn.py", line: 2, side: "RIGHT" }))).toBe(false);
    expect(isOutdatedComment([FILE], made({ id: 2, path: "src/conn.py", line: 2, side: "LEFT" }))).toBe(false);
  });

  it("flags moved lines and removed files as outdated", () => {
    expect(isOutdatedComment([FILE], made({ id: 1, path: "src/conn.py", line: 500 }))).toBe(true);
    expect(isOutdatedComment([FILE], made({ id: 2, path: "src/gone.py", line: 1 }))).toBe(true);
  });

  it("keeps file-level and general comments current", () => {
    expect(isOutdatedComment([FILE], made({ id: 1, path: "src/conn.py" }))).toBe(false);
    expect(isOutdatedComment([FILE], made({ id: 2 }))).toBe(false);
  });
});

describe("resolveGithubThreads", () => {
  it("attaches file keys and outdated flags", () => {
    const threads = resolveGithubThreads(
      [FILE],
      [made({ id: 1, path: "src/conn.py", line: 2 }), made({ id: 2, path: "src/conn.py", line: 500 })],
    );
    expect(threads[0]).toMatchObject({ fileKey: "src-conn-py", line: 2, outdated: false });
    expect(threads[1]).toMatchObject({ fileKey: "src-conn-py", line: 500, outdated: true });
  });
});
