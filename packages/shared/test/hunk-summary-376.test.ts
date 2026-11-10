/**
 * Issue #376: top-N hunk-summary selection — category order, generated
 * exclusion, hidden exclusion, the cap, cited-first re-prioritisation,
 * and "next N".
 */
import { describe, expect, it } from "vitest";
import {
  countMissingSummaries,
  selectHunkSummaryTargets,
  type HunkSummaryCandidate,
} from "../src/hunk-summary.js";

function cand(
  contentHash: string,
  category: HunkSummaryCandidate["category"],
  order: number,
  opts: Partial<HunkSummaryCandidate> = {},
): HunkSummaryCandidate {
  return {
    contentHash,
    category,
    hidden: false,
    hasSummary: false,
    hasLiveJob: false,
    order,
    ...opts,
  };
}

describe("selectHunkSummaryTargets (#376)", () => {
  it("orders source, then tests, then config, then docs", () => {
    const hunks = [
      cand("docs-0", "docs", 0),
      cand("config-0", "config", 1),
      cand("tests-0", "tests", 2),
      cand("source-0", "source", 3),
    ];
    expect(selectHunkSummaryTargets(hunks, { limit: 10 })).toEqual([
      "source-0",
      "tests-0",
      "config-0",
      "docs-0",
    ]);
  });

  it("keeps diff order within a category", () => {
    const hunks = [cand("b", "source", 5), cand("a", "source", 2), cand("c", "source", 9)];
    expect(selectHunkSummaryTargets(hunks, { limit: 10 })).toEqual(["a", "b", "c"]);
  });

  it("never selects generated files", () => {
    const hunks = [cand("gen-0", "generated", 0), cand("src-0", "source", 1)];
    expect(selectHunkSummaryTargets(hunks, { limit: 10 })).toEqual(["src-0"]);
  });

  it("never selects hidden hunks", () => {
    const hunks = [
      cand("hidden-src", "source", 0, { hidden: true }),
      cand("shown-src", "source", 1),
    ];
    expect(selectHunkSummaryTargets(hunks, { limit: 10 })).toEqual(["shown-src"]);
  });

  it("skips hunks with summaries and hunks with live jobs", () => {
    const hunks = [
      cand("done", "source", 0, { hasSummary: true }),
      cand("live", "source", 1, { hasLiveJob: true }),
      cand("todo", "source", 2),
    ];
    expect(selectHunkSummaryTargets(hunks, { limit: 10 })).toEqual(["todo"]);
  });

  it("caps at the limit", () => {
    const hunks = [cand("a", "source", 0), cand("b", "source", 1), cand("c", "source", 2)];
    expect(selectHunkSummaryTargets(hunks, { limit: 2 })).toEqual(["a", "b"]);
  });

  it("selects nothing at 0", () => {
    const hunks = [cand("a", "source", 0)];
    expect(selectHunkSummaryTargets(hunks, { limit: 0 })).toEqual([]);
  });

  it("cited hunks take priority within the same limit", () => {
    const hunks = [
      cand("src-0", "source", 0),
      cand("src-1", "source", 1),
      cand("docs-0", "docs", 2),
    ];
    // Without citations the docs hunk loses to the second source hunk.
    expect(selectHunkSummaryTargets(hunks, { limit: 2 })).toEqual(["src-0", "src-1"]);
    // Cited, it jumps ahead — still only two jobs, no extra budget.
    expect(selectHunkSummaryTargets(hunks, { limit: 2, cited: new Set(["docs-0"]) })).toEqual([
      "docs-0",
      "src-0",
    ]);
  });

  it("cited-but-hidden hunks are still excluded", () => {
    const hunks = [cand("hidden", "source", 0, { hidden: true })];
    expect(selectHunkSummaryTargets(hunks, { limit: 5, cited: new Set(["hidden"]) })).toEqual([]);
  });

  it("the next N over the missing hunks continues the order", () => {
    const all = [
      cand("src-0", "source", 0),
      cand("src-1", "source", 1),
      cand("tst-0", "tests", 2),
      cand("cfg-0", "config", 3),
      cand("doc-0", "docs", 4),
    ];
    const first = selectHunkSummaryTargets(all, { limit: 2 });
    expect(first).toEqual(["src-0", "src-1"]);
    const rest = all.map((c) => (first.includes(c.contentHash) ? { ...c, hasSummary: true } : c));
    expect(selectHunkSummaryTargets(rest, { limit: 2 })).toEqual(["tst-0", "cfg-0"]);
  });

  it("counts missing summaries", () => {
    expect(countMissingSummaries([cand("a", "source", 0), cand("b", "source", 1, { hasSummary: true })])).toBe(1);
  });
});
