/**
 * Preview publish helpers (issue #36): slug + version derivation, the
 * preview-only push guard, worktree resolution. Pure
 * `scripts/preview-lib.mjs` units — no network, no git runs.
 */
import { describe, expect, it } from "vitest";
import {
  assertPreviewDeleteRef,
  assertPreviewPushRefspec,
  branchSlug,
  buildUnvibeField,
  isPreviewRef,
  isPrereleaseIdentifier,
  isValidPreviewVersion,
  parseWorktreeList,
  previewPushRefspec,
  previewRef,
  previewVersion,
  resolveWorktree,
  selectAllBranches,
  selectPruneRefs,
} from "../../../scripts/preview-lib.mjs";

describe("branchSlug", () => {
  it("makes branch names safe for semver + ref segments", () => {
    expect(branchSlug("feat/repo-add-by-url")).toBe("feat-repo-add-by-url");
    expect(branchSlug("feat/preview-builds")).toBe("feat-preview-builds");
    expect(branchSlug("ui/start-page-repo-scope")).toBe("ui-start-page-repo-scope");
    expect(branchSlug("main")).toBe("main");
    expect(branchSlug("release")).toBe("release");
  });

  it("collapses runs, trims dashes, drops empties", () => {
    expect(branchSlug("a//b__c..d")).toBe("a-b-c-d");
    expect(branchSlug("/leading/trailing/")).toBe("leading-trailing");
    expect(branchSlug("has space and\ttab")).toBe("has-space-and-tab");
    expect(branchSlug("///")).toBe("");
    expect(branchSlug("")).toBe("");
  });

  it("prefixes purely numeric slugs (semver forbids leading-zero numerics)", () => {
    expect(branchSlug("123")).toBe("b123");
    expect(branchSlug("007")).toBe("b007");
    // Alphanumeric identifiers may start with digits — left alone.
    expect(branchSlug("2fa-fix")).toBe("2fa-fix");
  });
});

describe("preview version", () => {
  it("assembles <base>-preview.<slug>.<sha>", () => {
    expect(previewVersion("0.0.1", "feat-preview-builds", "4d31b17")).toBe(
      "0.0.1-preview.feat-preview-builds.4d31b17",
    );
  });

  it("accepts the brief's shape as strict semver", () => {
    expect(isValidPreviewVersion("0.0.1-preview.feat-preview-builds.4d31b17")).toBe(true);
    expect(isValidPreviewVersion("0.0.1-preview.main.abcdef0")).toBe(true);
  });

  it("rejects non-preview and malformed versions", () => {
    expect(isValidPreviewVersion("0.0.1")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-rc.1")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-preview.feat_x.abc")).toBe(false); // _ not allowed
    expect(isValidPreviewVersion("0.0.1-preview..abc")).toBe(false);
    expect(isValidPreviewVersion("0.0.1-preview.007.abc")).toBe(false); // leading-zero numeric
    expect(isValidPreviewVersion("not-a-version")).toBe(false);
  });

  it("checks prerelease identifiers per semver §9", () => {
    expect(isPrereleaseIdentifier("feat-x")).toBe(true);
    expect(isPrereleaseIdentifier("0")).toBe(true);
    expect(isPrereleaseIdentifier("007")).toBe(false);
    expect(isPrereleaseIdentifier("")).toBe(false);
    expect(isPrereleaseIdentifier("a_b")).toBe(false);
  });
});

describe("preview push guard", () => {
  it("builds the only pushable refspec", () => {
    expect(previewRef("feat-x")).toBe("preview/feat-x");
    expect(previewPushRefspec("feat-x")).toBe(
      "refs/heads/preview/feat-x:refs/heads/preview/feat-x",
    );
    expect(() => previewPushRefspec("../release")).toThrow();
  });

  it("accepts only preview/*-onto-itself refspecs", () => {
    expect(assertPreviewPushRefspec("refs/heads/preview/feat-x:refs/heads/preview/feat-x")).toBe(
      "refs/heads/preview/feat-x:refs/heads/preview/feat-x",
    );
    for (const bad of [
      "refs/heads/release:refs/heads/release",
      "refs/heads/main:refs/heads/main",
      "refs/heads/preview/feat-x:refs/heads/preview/other",
      "refs/heads/preview/feat-x:refs/heads/release",
      "preview/feat-x",
      "",
    ]) {
      expect(() => assertPreviewPushRefspec(bad), bad).toThrow();
    }
  });

  it("recognises preview refs", () => {
    expect(isPreviewRef("preview/feat-x")).toBe(true);
    expect(isPreviewRef("release")).toBe(false);
    expect(isPreviewRef("preview/")).toBe(false);
    expect(isPreviewRef("preview/a/b")).toBe(false);
  });
});

const PORCELAIN = [
  "worktree /home/u/dev/unvibe",
  "HEAD 973dc34f04e30dda9205f743423f64a382ab4de5",
  "branch refs/heads/main",
  "",
  "worktree /home/u/.paseo/wt/preview-builds",
  "HEAD 4d31b171ff29a5d2035238ba3209ed4f8623ff1b",
  "branch refs/heads/feat/preview-builds",
  "",
  "worktree /home/u/.paseo/wt/detached",
  "HEAD 5de6af901b110c6508b25e65288469b391082edf",
  "detached",
  "",
].join("\n");

describe("worktree resolution", () => {
  it("parses porcelain entries incl. detached", () => {
    const entries = parseWorktreeList(PORCELAIN);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ path: "/home/u/dev/unvibe", branch: "main", detached: false });
    expect(entries[2]).toEqual({
      path: "/home/u/.paseo/wt/detached",
      branch: null,
      detached: true,
    });
  });

  it("resolves a branch to its worktree path, null when absent", () => {
    expect(resolveWorktree(PORCELAIN, "feat/preview-builds")).toBe(
      "/home/u/.paseo/wt/preview-builds",
    );
    expect(resolveWorktree(PORCELAIN, "main")).toBe("/home/u/dev/unvibe");
    expect(resolveWorktree(PORCELAIN, "no/such-branch")).toBeNull();
  });
});

describe("selectAllBranches (--all)", () => {
  it("publishes unmerged branches plus main itself, main first", () => {
    expect(selectAllBranches(["main", "feat/a", "fix/b"], ["feat/a", "fix/b"])).toEqual([
      "main",
      "feat/a",
      "fix/b",
    ]);
  });

  it("drops branches fully on main and publish artifacts", () => {
    expect(
      selectAllBranches(
        ["main", "feat/a", "merged-c", "preview/feat-a", "release"],
        ["feat/a"],
      ),
    ).toEqual(["main", "feat/a"]);
  });

  it("dedupes and omits main when it has no local branch", () => {
    expect(selectAllBranches(["feat/a", "feat/a"], ["feat/a"], "main")).toEqual(["feat/a"]);
  });
});

describe("buildUnvibeField (dual-side metadata)", () => {
  it("records both sides of a merged preview", () => {
    expect(
      buildUnvibeField({
        channel: "preview/feat-x",
        commit: "merge123",
        builtAt: "2026-10-12T00:00:00.000Z",
        sourceBranch: "feat/x",
        sourceVersion: "0.0.1",
        sourceCommit: "aaa111",
        baseBranch: "main",
        baseCommit: "bbb222",
      }),
    ).toEqual({
      channel: "preview/feat-x",
      commit: "merge123",
      builtAt: "2026-10-12T00:00:00.000Z",
      sourceBranch: "feat/x",
      sourceVersion: "0.0.1",
      sourceCommit: "aaa111",
      baseBranch: "main",
      baseCommit: "bbb222",
    });
  });

  it("leaves unknown sides null for old builds", () => {
    const f = buildUnvibeField({
      channel: "release",
      commit: "ccc333",
      builtAt: "2026-10-12T00:00:00.000Z",
      sourceBranch: null,
      sourceVersion: "0.0.1",
    });
    expect(f.sourceCommit).toBeNull();
    expect(f.baseBranch).toBeNull();
    expect(f.baseCommit).toBeNull();
  });
});

describe("selectPruneRefs (--prune)", () => {
  const entries = [
    { ref: "preview/feat-a", sourceBranch: "feat/a" },
    { ref: "preview/feat-b", sourceBranch: "feat/b" },
    { ref: "preview/main", sourceBranch: "main" },
    { ref: "preview/unknown", sourceBranch: null },
  ];

  it("selects merged and deleted source branches with reasons", () => {
    expect(selectPruneRefs(entries, ["feat/a"], ["main", "feat/a", "feat/b"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
    ]);
    expect(selectPruneRefs(entries, [], ["main"])).toEqual([
      { ref: "preview/feat-a", reason: "source-branch deleted" },
      { ref: "preview/feat-b", reason: "source-branch deleted" },
    ]);
  });

  it("keeps the base's own preview and refs with unknown sources", () => {
    expect(selectPruneRefs(entries, ["main", "feat/a", "feat/b"], ["main", "feat/a", "feat/b"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
      { ref: "preview/feat-b", reason: "merged" },
    ]);
  });

  it("never selects refs outside preview/", () => {
    const mixed = [
      ...entries,
      { ref: "release", sourceBranch: "feat/a" },
      { ref: "main", sourceBranch: "feat/a" },
      { ref: "../escape", sourceBranch: "feat/a" },
    ];
    expect(selectPruneRefs(mixed, ["feat/a"], ["main", "feat/a"])).toEqual([
      { ref: "preview/feat-a", reason: "merged" },
      { ref: "preview/feat-b", reason: "source-branch deleted" },
    ]);
  });
});

describe("assertPreviewDeleteRef", () => {
  it("accepts only preview/* refs", () => {
    expect(assertPreviewDeleteRef("preview/feat-x")).toBe("preview/feat-x");
    for (const bad of ["release", "main", "preview/", "preview/a/b", "", "../x"]) {
      expect(() => assertPreviewDeleteRef(bad), bad).toThrow();
    }
  });
});
