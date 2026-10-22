/**
 * File-tab entry point (#81): one tab per file at a commit, opened
 * through the same `openFileAtCommit` #222 reuses.
 */
import { describe, expect, it, vi } from "vitest";
import { OPEN_FILE_EVENT, openFileAtCommit, openFileForCitation, openFileKey } from "./openFile.js";

describe("openFile", () => {
  it("keys tabs by path and commit", () => {
    expect(openFileKey({ path: "a/b.py", commit: "abc1234" })).toBe("a/b.py@abc1234");
  });

  it("dispatches the request for a code citation", () => {
    const seen: unknown[] = [];
    const onEvent = (e: Event): void => {
      seen.push((e as CustomEvent).detail);
    };
    window.addEventListener(OPEN_FILE_EVENT, onEvent);
    try {
      expect(openFileForCitation("code:src/helper.py:2-3@abc1234def5678")).toBe(true);
      expect(seen).toEqual([{ path: "src/helper.py", commit: "abc1234def5678", start: 2, end: 3 }]);
      expect(openFileForCitation("diff:a-py:1-2")).toBe(false);
    } finally {
      window.removeEventListener(OPEN_FILE_EVENT, onEvent);
    }
  });

  it("ignores requests without a hex commit", () => {
    const fn = vi.fn();
    window.addEventListener(OPEN_FILE_EVENT, fn);
    try {
      openFileAtCommit({ path: "a.py", commit: "not-a-sha" });
      expect(fn).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(OPEN_FILE_EVENT, fn);
    }
  });
});
