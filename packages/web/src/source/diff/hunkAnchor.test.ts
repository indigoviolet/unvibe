/**
 * Hunk-anchor helpers (issue #138): attribute parsing, hunk lookup, the
 * comment line (first added new-side line, else the removal position)
 * and the GitHub range.
 */
import { describe, expect, test } from "vitest";
import type { Hunk, ReviewSnapshot } from "@unvibe/shared";
import {
  firstChangedLine,
  hunkCommentAnchor,
  hunkDiffRange,
  parseHunkAttr,
  promotedPageForHunk,
} from "./hunkAnchor.js";

function hunk(over: Partial<Hunk> = {}): Hunk {
  return {
    contentHash: "hash1",
    header: "@@ -1 +2 @@",
    newStart: 10,
    newEnd: 12,
    oldStart: 8,
    oldEnd: 9,
    added: 2,
    removed: 1,
    lines: [
      { kind: "ctx", oldLine: 8, newLine: 10, text: "a" },
      { kind: "del", oldLine: 9, text: "b" },
      { kind: "add", newLine: 11, text: "c" },
      { kind: "add", newLine: 12, text: "d" },
    ],
    ...over,
  };
}

function snapshot(hunks: Hunk[]): ReviewSnapshot {
  return {
    review: { id: "r", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [{ fileKey: "conn", path: "src/conn.py", category: "source", hunks }],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot;
}

describe("hunkAnchor", () => {
  test("parseHunkAttr splits at the last colon", () => {
    expect(parseHunkAttr("conn:hash1")).toEqual({ fileKey: "conn", contentHash: "hash1" });
    expect(parseHunkAttr(undefined)).toBeNull();
    expect(parseHunkAttr("nocolon")).toBeNull();
    expect(parseHunkAttr(":hash")).toBeNull();
  });

  test("firstChangedLine prefers the first added line", () => {
    expect(firstChangedLine(hunk())).toBe(11);
  });

  test("firstChangedLine on a removed-only hunk falls back to the removal position", () => {
    const removed = hunk({
      newStart: 10,
      newEnd: 9,
      added: 0,
      lines: [
        { kind: "ctx", oldLine: 8, newLine: 10, text: "a" },
        { kind: "del", oldLine: 9, text: "b" },
      ],
    });
    expect(firstChangedLine(removed)).toBe(10);
  });

  test("hunkCommentAnchor maps a summary Comment to the first changed line", () => {
    expect(hunkCommentAnchor(snapshot([hunk()]), { fileKey: "conn", contentHash: "hash1" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 11,
    });
    expect(hunkCommentAnchor(snapshot([hunk()]), { fileKey: "conn", contentHash: "nope" })).toBeNull();
  });

  test("hunkDiffRange spans the hunk's lines", () => {
    expect(hunkDiffRange(snapshot([hunk()]), { fileKey: "conn", contentHash: "hash1" })).toEqual({
      fileKey: "conn",
      newLines: [10, 11, 12],
      oldLines: [8, 9],
    });
  });

  test("promotedPageForHunk finds the moved discussion, if any", () => {
    const ref = { fileKey: "conn", contentHash: "hash1" };
    expect(promotedPageForHunk(snapshot([hunk()]), ref)).toBeNull();
    const snap = snapshot([hunk()]);
    (snap.annotations as import("@unvibe/shared").Thread[]).push({
      id: "ann_link",
      type: "link",
      anchor: {
        host: { kind: "hunk", fileKey: "conn", contentHash: "hash1" },
        quotedText: "",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: false,
      replies: [],
      post: false,
      promotedToPage: "p-9",
    } as unknown as import("@unvibe/shared").Thread);
    expect(promotedPageForHunk(snap, ref)).toBe("p-9");
    expect(promotedPageForHunk(snap, { fileKey: "conn", contentHash: "other" })).toBeNull();
  });
});
