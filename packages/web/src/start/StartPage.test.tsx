/**
 * #91: PR rows with no `branch` (as `gh search prs` returns them) render
 * `#N`, never `#N · undefined`, and never a dangling separator.
 */
import { describe, expect, test } from "vitest";
import type { RepoChange } from "@unvibe/shared";
import { AUTHOR_ALL, authorCounts, changeHead, matchesAuthor } from "./StartPage.js";

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

describe("author filter (#228)", () => {
  test("All passes everything, including rows with no known author", () => {
    expect(matchesAuthor("alice", AUTHOR_ALL)).toBe(true);
    expect(matchesAuthor(undefined, AUTHOR_ALL)).toBe(true);
  });

  test("a specific author passes matching rows and author-less rows", () => {
    expect(matchesAuthor("alice", "alice")).toBe(true);
    expect(matchesAuthor("bob", "alice")).toBe(false);
    // Requested-review rows with no known author stay visible (unknown,
    // not a mismatch — same rule as the recency window).
    expect(matchesAuthor(undefined, "alice")).toBe(true);
    expect(matchesAuthor("", "alice")).toBe(true);
  });

  test("counts cover the requested-review rows, skipping author-less rows", () => {
    const counts = authorCounts([
      { kind: "pr", title: "a", author: "alice" },
      { kind: "pr", title: "b", author: "alice" },
      { kind: "pr", title: "c", author: "bob" },
      { kind: "pr", title: "d" },
    ] as RepoChange[]);
    expect(counts.get("alice")).toBe(2);
    expect(counts.get("bob")).toBe(1);
    expect(counts.has("")).toBe(false);
    expect(counts.size).toBe(2);
  });
});
