/**
 * Kept PR/branch lists storage (issue #90): versioned key, validation,
 * 10-repo cap, and graceful degradation when storage is unavailable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetKeptForTests,
  KEPT_CHANGES_KEY,
  MAX_KEPT_REPOS,
  clearAllKeptLists,
  clearKeptLists,
  getKeptLists,
  getKeptViewer,
  initialKept,
  keptStatusText,
  pruneKeptLists,
  setKeptLists,
  setKeptViewer,
} from "./keptChanges.js";

const ENTRY = {
  authoring: [{ kind: "pr" as const, title: "Kept PR", prNumber: 99, branch: "kept-branch" }],
  requested: [],
  branches: [{ kind: "branch" as const, title: "kept-branch", branch: "kept-branch" }],
  fetchNote: null as string | null,
};

afterEach(() => {
  localStorage.clear();
  __resetKeptForTests();
  vi.restoreAllMocks();
});

describe("keptChanges storage", () => {
  it("rounds-trips a saved entry with a client fetch time", () => {
    const before = Date.now();
    const saved = setKeptLists("r1", ENTRY);
    expect(saved.fetchedAt).toBeGreaterThanOrEqual(before);
    const back = getKeptLists("r1");
    expect(back).toEqual(saved);
    expect(back?.authoring[0].prNumber).toBe(99);
  });

  it("drops a malformed stored entry instead of throwing", () => {
    localStorage.setItem(KEPT_CHANGES_KEY, "not json{{{");
    __resetKeptForTests();
    expect(getKeptLists("r1")).toBeNull();

    localStorage.setItem(
      KEPT_CHANGES_KEY,
      JSON.stringify({ version: 1, viewer: null, repos: { r1: { authoring: "oops" } } }),
    );
    __resetKeptForTests();
    expect(getKeptLists("r1")).toBeNull();
  });

  it("drops an old-shape (unversioned) entry", () => {
    localStorage.setItem(
      KEPT_CHANGES_KEY,
      JSON.stringify({ version: 0, viewer: null, repos: { r1: { ...ENTRY, fetchedAt: Date.now() } } }),
    );
    __resetKeptForTests();
    expect(getKeptLists("r1")).toBeNull();
  });

  it("ignores the demo pseudo-repo", () => {
    setKeptLists("demo", ENTRY);
    expect(getKeptLists("demo")).toBeNull();
  });

  it(`caps what is kept at ${MAX_KEPT_REPOS} repos, oldest first`, () => {
    for (let i = 0; i < MAX_KEPT_REPOS + 1; i++) {
      setKeptLists(`r${i}`, ENTRY);
    }
    expect(getKeptLists("r0")).toBeNull();
    expect(getKeptLists(`r${MAX_KEPT_REPOS}`)).not.toBeNull();
  });

  it("carries on without storage when it is unavailable or full", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    __resetKeptForTests();
    // Reads degrade to null, writes degrade to a no-op: never throws.
    expect(getKeptLists("r1")).toBeNull();
    expect(() => setKeptLists("r1", ENTRY)).not.toThrow();
    expect(() => pruneKeptLists(["r1"])).not.toThrow();
    expect(() => clearKeptLists("r1")).not.toThrow();
    expect(() => clearAllKeptLists()).not.toThrow();
  });

  it("prunes repos no longer in the list and clears a removed repo", () => {
    setKeptLists("keep", ENTRY);
    setKeptLists("gone", ENTRY);
    pruneKeptLists(["keep"]);
    expect(getKeptLists("keep")).not.toBeNull();
    expect(getKeptLists("gone")).toBeNull();
    clearKeptLists("keep");
    expect(getKeptLists("keep")).toBeNull();
  });

  it("tracks the viewer login for login-change detection", () => {
    expect(getKeptViewer()).toBeNull();
    setKeptViewer("you");
    expect(getKeptViewer()).toBe("you");
  });

  it("reads the initial repo's entry once and never throws", () => {
    localStorage.setItem("unvibe.start.repoId", "r1");
    setKeptLists("r1", ENTRY);
    const found = initialKept("unvibe.start.repoId");
    expect(found.repoId).toBe("r1");
    expect(found.kept?.authoring[0].prNumber).toBe(99);

    localStorage.setItem("unvibe.start.repoId", "demo");
    expect(initialKept("unvibe.start.repoId")).toEqual({ repoId: null, kept: null });

    localStorage.removeItem("unvibe.start.repoId");
    expect(initialKept("unvibe.start.repoId")).toEqual({ repoId: null, kept: null });
  });

  it("describes the kept age in short plain words", () => {
    const now = Date.now();
    expect(keptStatusText(null, true, now)).toBeNull();
    expect(keptStatusText(now - 10_000, false, now)).toBe("Updated just now");
    expect(keptStatusText(now - 3 * 60_000, true, now)).toBe("Updated 3m ago · refreshing…");
    expect(keptStatusText(now - 2 * 3600_000, false, now)).toBe("Updated 2h ago");
  });
});
