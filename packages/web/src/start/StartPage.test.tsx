/**
 * #91: PR rows with no `branch` (as `gh search prs` returns them) render
 * `#N`, never `#N · undefined`, and never a dangling separator.
 */
import { describe, expect, test } from "vitest";
import type { RepoChange } from "@unvibe/shared";
import { changeHead } from "./StartPage.js";

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
