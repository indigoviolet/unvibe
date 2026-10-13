/**
 * #91: PR rows with no `branch` (as `gh search prs` returns them) render
 * `#N`, never `#N · undefined`, and never a dangling separator.
 */
import { describe, expect, test } from "vitest";
import type { RepoChange } from "@unvibe/shared";
import { changeHead, diffSizeParts } from "./StartPage.js";

describe("changeHead (#91)", () => {
  test("PR row with a branch shows number and branch", () => {
    const c: RepoChange = { kind: "pr", title: "T", prNumber: 5020, branch: "fix-obs-fold" };
    expect(changeHead(c)).toBe("#5020 · fix-obs-fold");
  });

  test("PR row without a branch shows just the number", () => {
    const c: RepoChange = { kind: "pr", title: "T", prNumber: 5011 };
    const head = changeHead(c);
    expect(head).toBe("#5011");
    expect(head).not.toContain("undefined");
    expect(head.endsWith("·")).toBe(false);
    expect(head.endsWith("· ")).toBe(false);
  });

  test("branch rows still show the branch", () => {
    const c: RepoChange = { kind: "branch", title: "main", branch: "main" };
    expect(changeHead(c)).toBe("main");
  });
});

describe("diffSizeParts (#100)", () => {
  test("formats additions, deletions and file count", () => {
    expect(
      diffSizeParts({ additions: 120, deletions: 34, changedFiles: 6 }),
    ).toEqual({ additions: "+120", deletions: "−34", files: "6 files" });
  });

  test("large numbers stay readable and one file stays singular", () => {
    expect(diffSizeParts({ additions: 1200, deletions: 0, changedFiles: 1 })).toEqual({
      additions: "+1,200",
      deletions: "−0",
      files: "1 file",
    });
  });

  test("partial sizes render the known parts", () => {
    expect(diffSizeParts({ additions: 9 })).toEqual({ additions: "+9", deletions: null, files: null });
    expect(diffSizeParts({ changedFiles: 3 })).toEqual({ additions: null, deletions: null, files: "3 files" });
  });

  test("no size data is null (the row omits the size)", () => {
    expect(diffSizeParts({})).toBeNull();
  });
});
