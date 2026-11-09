/**
 * Issue #367: the one shared update-availability predicate. The service
 * refuses an update when this is false, so the web UI must not offer one
 * either — card banners and the diff banner both read this.
 */
import { describe, expect, it } from "vitest";
import { isUpdateAvailable, type VersionStatus } from "../src/versions.js";

function status(stale: boolean): VersionStatus {
  return {
    stale,
    fromVersion: 1,
    toVersion: 2,
    unchangedHunks: 0,
    changedHunks: 1,
    newHunks: 0,
    removedHunks: 0,
    renamedFiles: [],
    changedOldIds: [],
    changedNewIds: [],
    rangeDiff: "",
    fetchedAt: 0,
  };
}

describe("isUpdateAvailable", () => {
  it("is true only while the review is stale", () => {
    expect(isUpdateAvailable(status(true))).toBe(true);
    expect(isUpdateAvailable(status(false))).toBe(false);
  });

  it("is false without a version status", () => {
    expect(isUpdateAvailable(undefined)).toBe(false);
    expect(isUpdateAvailable(null)).toBe(false);
  });
});
