// DISABLED(#188): covered by J7
/**
 * Large-diff behaviour (`VITE_MOCK=1`): split out of DiffView.test.tsx
 * (issue #119) so the 300-file render runs on its own vitest worker.
 * Headers mount for all files while hunk bodies stay lazy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useReview } from "../../state/store.js";
import { resetMockState, setMockLatency } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  setMockLatency(0);
  useReview.getState().clear();
});

afterEach(() => {
  setMockLatency(null);
  cleanup();
});


describe("DiffView large diff", () => {
  it("stays usable on a 300-file, 5k-hunk diff (headers mount, bodies lazy)", async () => {
    // Fake an IntersectionObserver that never fires: only eager files may
    // render their hunk tables.
    const RealIO = globalThis.IntersectionObserver;
    class NeverIO {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NeverIO;
    try {
      useReview.getState().setSnapshot(makeBigSnapshot());
      render(<DiffView reviewId="big" />);
      await screen.findByText("file-0.ts", {}, { timeout: 5000 });
      expect(document.querySelectorAll(".dfile").length).toBe(300);
      // One code table per hunk (#140): the 3 eager files × 17 hunks each.
      // The other 297 files mount headers only (no tables, no hunk bodies).
      expect(document.querySelectorAll("table.diff").length).toBe(3 * 17);
    } finally {
      if (RealIO) globalThis.IntersectionObserver = RealIO;
      else delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  });
});

function makeBigSnapshot(): import("@unvibe/shared").ReviewSnapshot {
  const files = Array.from({ length: 300 }, (_, fi) => ({
    fileKey: `big-${fi}`,
    path: `src/big/file-${fi}.ts`,
    category: "source" as const,
    hunks: Array.from({ length: 17 }, (_, hi) => {
      const base = hi * 10;
      return {
        contentHash: `big-${fi}-${hi}`,
        header: `@@ -${base + 1},5 +${base + 1},5 @@ fn${hi}`,
        context: `fn${hi}`,
        newStart: base + 1,
        newEnd: base + 5,
        oldStart: base + 1,
        oldEnd: base + 5,
        added: 2,
        removed: 1,
        lines: [
          { kind: "ctx" as const, oldLine: base + 1, newLine: base + 1, text: "a" },
          { kind: "ctx" as const, oldLine: base + 2, newLine: base + 2, text: "b" },
          { kind: "del" as const, oldLine: base + 3, text: "c" },
          { kind: "add" as const, newLine: base + 3, text: "d" },
          { kind: "add" as const, newLine: base + 4, text: "e" },
          { kind: "ctx" as const, oldLine: base + 4, newLine: base + 5, text: "f" },
        ],
      };
    }),
  }));
  return {
    review: {
      id: "big",
      repoId: "urllib3",
      branch: "big",
      versions: [],
      currentVersion: 1,
      createdAt: Date.now(),
    },
    version: { n: 1, headSha: "abc1234", mergeBaseSha: "def5678", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files,
    ingest: { status: "ready" },
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
}

