/**
 * Issue #413: the shared new-commits signal. The banner and the
 * start-page marks read hunk counts, never a flag: true exactly when
 * the status names real hunk changes.
 */
import { describe, expect, it } from "vitest";
import { hasNewCommits, type VersionStatus } from "../src/versions.js";

function status(changedHunks: number, newHunks: number, removedHunks: number): VersionStatus {
  return {
    fromVersion: 1,
    toVersion: 2,
    unchangedHunks: 0,
    changedHunks,
    newHunks,
    removedHunks,
    renamedFiles: [],
    changedOldIds: [],
    changedNewIds: [],
    fetchedAt: 0,
  };
}

describe("hasNewCommits", () => {
  it("is true when the status names hunk changes", () => {
    expect(hasNewCommits(status(1, 0, 0))).toBe(true);
    expect(hasNewCommits(status(0, 2, 0))).toBe(true);
    expect(hasNewCommits(status(0, 0, 1))).toBe(true);
  });

  it("is false on a no-change refresh or without a status", () => {
    expect(hasNewCommits(status(0, 0, 0))).toBe(false);
    expect(hasNewCommits(undefined)).toBe(false);
    expect(hasNewCommits(null)).toBe(false);
  });
});
