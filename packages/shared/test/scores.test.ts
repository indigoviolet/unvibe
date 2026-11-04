/**
 * Hunk scores + plotlines contract (issue #169): the small interface a
 * later source (the Decisions API) can replace without touching the UI
 * or the stored shape.
 */
import { describe, expect, it } from "vitest";
import {
  formatHideLevelStats,
  hideButtonLabel,
  hideLevelAfterCategoryClick,
  hideLevelForHiddenUpTo,
  hideLevelHiddenUpTo,
  hideLevelStats,
  hunkCategory,
  hunkMatchesFilter,
  MAX_PLOTLINE_DESCRIPTION,
  MAX_PLOTLINE_NAME,
  MAX_PLOTLINES,
  normalizeHideLevel,
  normalizeHunkScore,
  normalizePlotlines,
  PLOTLINE_OTHER_ID,
  resolveHunkScore,
  shouldHideAtLevel,
} from "../src/scores.js";

describe("normalizeHunkScore", () => {
  it("accepts the four levels", () => {
    expect(normalizeHunkScore("mechanical")).toBe("mechanical");
    expect(normalizeHunkScore("routine")).toBe("routine");
    expect(normalizeHunkScore("substantive")).toBe("substantive");
    expect(normalizeHunkScore("needs-attention")).toBe("needs-attention");
  });

  it("is tolerant of case and spacing", () => {
    expect(normalizeHunkScore("Needs Attention")).toBe("needs-attention");
    expect(normalizeHunkScore("  ROUTINE ")).toBe("routine");
  });

  it("rejects invented and missing values", () => {
    expect(normalizeHunkScore("hot")).toBeNull();
    expect(normalizeHunkScore("needs_attention")).toBeNull();
    expect(normalizeHunkScore("")).toBeNull();
    expect(normalizeHunkScore(null)).toBeNull();
    expect(normalizeHunkScore(undefined)).toBeNull();
    expect(normalizeHunkScore(3)).toBeNull();
  });
});

describe("resolveHunkScore", () => {
  it("stores the agent value as returned", () => {
    expect(resolveHunkScore("substantive", { isOneLine: false })).toBe("substantive");
    expect(resolveHunkScore("mechanical", { isOneLine: false })).toBe("mechanical");
  });

  it("reads a missing value as routine", () => {
    expect(resolveHunkScore(null, { isOneLine: false })).toBe("routine");
  });

  it("never stores mechanical for a one-line change", () => {
    expect(resolveHunkScore("mechanical", { isOneLine: true })).toBe("routine");
    expect(resolveHunkScore(null, { isOneLine: true })).toBe("routine");
    expect(resolveHunkScore("substantive", { isOneLine: true })).toBe("substantive");
  });
});

const KNOWN = new Set(["h:conn:aaa", "h:conn:bob", "h:tst:ccc"]);

describe("normalizePlotlines", () => {
  it("assigns hunk IDs to named plotlines", () => {
    const got = normalizePlotlines(
      [
        { id: "retry", name: "Retry logic", description: "Retries failed uploads.", hunks: ["h:conn:aaa"] },
        { name: "Prove retries work", description: "Coverage.", buildsOn: "retry", hunks: ["h:tst:ccc"] },
      ],
      KNOWN,
    );
    expect(got.plotlines).toHaveLength(2);
    expect(got.plotlines[0]).toMatchObject({ id: "retry", name: "Retry logic" });
    expect(got.plotlines[1].buildsOn).toBe("retry");
    expect(got.plotlines[1].id).toBe("prove-retries-work");
    expect(got.assignment).toEqual({ "h:conn:aaa": "retry", "h:tst:ccc": "prove-retries-work" });
    expect(got.dropped).toEqual({ unknown: [], duplicates: [], extraPlotlines: 0 });
  });

  it("drops unknown hunk IDs and keeps the rest", () => {
    const got = normalizePlotlines(
      [{ name: "Retry logic", hunks: ["h:conn:aaa", "h:nope:zzz", "diff:conn:1-2", "garbage"] }],
      KNOWN,
    );
    expect(got.assignment).toEqual({ "h:conn:aaa": "retry-logic" });
    expect(got.dropped.unknown).toEqual(["h:nope:zzz", "diff:conn:1-2", "garbage"]);
  });

  it("keeps the first plotline for a twice-claimed hunk", () => {
    const got = normalizePlotlines(
      [
        { name: "First", hunks: ["h:conn:aaa"] },
        { name: "Second", hunks: ["h:conn:aaa", "h:conn:bob"] },
      ],
      KNOWN,
    );
    expect(got.assignment).toEqual({ "h:conn:aaa": "first", "h:conn:bob": "second" });
    expect(got.dropped.duplicates).toEqual(["h:conn:aaa"]);
  });

  it("reads empty and missing input as no plotlines (all other)", () => {
    expect(normalizePlotlines([], KNOWN).plotlines).toEqual([]);
    expect(normalizePlotlines(undefined, KNOWN).plotlines).toEqual([]);
    expect(normalizePlotlines({ plotlines: [] }, KNOWN).plotlines).toEqual([]);
  });

  it(`caps at ${MAX_PLOTLINES} plotlines`, () => {
    const input = Array.from({ length: 10 }, (_, i) => ({ name: `Thread ${i}`, hunks: [] }));
    const got = normalizePlotlines(input, KNOWN);
    expect(got.plotlines).toHaveLength(MAX_PLOTLINES);
    expect(got.dropped.extraPlotlines).toBe(2);
  });

  it("drops nameless entries and dedupes ids", () => {
    const got = normalizePlotlines(
      [{ description: "no name", hunks: [] }, { name: "Same", hunks: [] }, { name: "Same", hunks: [] }],
      KNOWN,
    );
    expect(got.plotlines.map((p) => p.id)).toEqual(["same", "same-2"]);
  });

  it("drops unknown or self buildsOn references", () => {
    const got = normalizePlotlines(
      [
        { name: "Self", buildsOn: "self", hunks: ["h:conn:bob"] },
        { name: "Dangling", buildsOn: "nope", hunks: ["h:tst:ccc"] },
      ],
      KNOWN,
    );
    expect(got.plotlines.map((p) => p.id)).toEqual(["self", "dangling"]);
    expect(got.plotlines[0].buildsOn).toBeUndefined();
    expect(got.plotlines[1].buildsOn).toBeUndefined();
    expect(got.assignment).toEqual({ "h:conn:bob": "self", "h:tst:ccc": "dangling" });
  });

  it("cleans names and descriptions to short single lines", () => {
    const got = normalizePlotlines(
      [{ name: "  Retry\nlogic  ", description: "Line one.\nLine two.", hunks: [] }],
      KNOWN,
    );
    expect(got.plotlines[0].name).toBe("Retry logic");
    expect(got.plotlines[0].description).toBe("Line one. Line two.");
  });

  it("stores a long name with a long identifier whole (#353)", () => {
    const name = "Add the `some_very_long_table_identifier_xyz` guard for the retry path";
    expect(name.length).toBeGreaterThan(60);
    const got = normalizePlotlines([{ id: "add-guard", name, hunks: [] }], KNOWN);
    expect(got.plotlines[0]?.name).toBe(name);
  });

  it("caps a very long name at a word boundary, never inside a token (#353)", () => {
    const name = `${"word ".repeat(30)}tail`;
    expect(name.length).toBeGreaterThan(MAX_PLOTLINE_NAME);
    const got = normalizePlotlines([{ id: "many-words", name, hunks: [] }], KNOWN);
    const stored = got.plotlines[0]?.name ?? "";
    expect(stored.length).toBeLessThanOrEqual(MAX_PLOTLINE_NAME);
    expect(stored.endsWith("…")).toBe(false);
    expect(name.startsWith(stored)).toBe(true);
    expect(name[stored.length]).toBe(" ");
  });

  it("keeps a single token longer than the cap whole (#353)", () => {
    const name = `add_the_${"x".repeat(130)}_guard`;
    expect(name).not.toContain(" ");
    expect(name.length).toBeGreaterThan(MAX_PLOTLINE_NAME);
    const got = normalizePlotlines([{ id: "long-token", name, hunks: [] }], KNOWN);
    expect(got.plotlines[0]?.name).toBe(name);
  });

  it("caps a very long description at a word boundary, keeping long tokens (#353)", () => {
    const description = `Covers the ${"y".repeat(150)}_identifier path and ${"extra detail ".repeat(20)}here`;
    expect(description.length).toBeGreaterThan(MAX_PLOTLINE_DESCRIPTION);
    const got = normalizePlotlines(
      [{ id: "retry", name: "Retry logic", description, hunks: [] }],
      KNOWN,
    );
    const stored = got.plotlines[0]?.description ?? "";
    expect(stored.length).toBeLessThanOrEqual(MAX_PLOTLINE_DESCRIPTION);
    expect(stored.endsWith("…")).toBe(false);
    expect(description.startsWith(stored)).toBe(true);
    expect(description[stored.length]).toBe(" ");
  });

  it("repairs a slug-echo name (name is the kebab-case id) into a display name", () => {
    const got = normalizePlotlines(
      [
        {
          id: "obs-fold-unfolding",
          name: "obs-fold-unfolding",
          description: "Unfolds obs-fold response header values.",
          hunks: ["h:conn:aaa"],
        },
      ],
      KNOWN,
    );
    expect(got.plotlines).toHaveLength(1);
    expect(got.plotlines[0]).toMatchObject({ id: "obs-fold-unfolding", name: "Obs fold unfolding" });
    expect(got.assignment).toEqual({ "h:conn:aaa": "obs-fold-unfolding" });
  });

  it("repairs a slug-like name when the id is derived from it", () => {
    const got = normalizePlotlines([{ name: "retry-logic", hunks: [] }], KNOWN);
    expect(got.plotlines).toHaveLength(1);
    expect(got.plotlines[0]).toMatchObject({ id: "retry-logic", name: "Retry logic" });
  });

  it("leaves a proper display name that happens to slugify near the id alone", () => {
    const got = normalizePlotlines([{ id: "retry", name: "Retry failed uploads", hunks: [] }], KNOWN);
    expect(got.plotlines[0]).toMatchObject({ id: "retry", name: "Retry failed uploads" });
  });
});

describe("hunkMatchesFilter", () => {
  it("passes everything without a filter", () => {
    expect(hunkMatchesFilter(undefined, undefined)).toBe(true);
    expect(hunkMatchesFilter("x", {})).toBe(true);
  });

  it("matches by plotline, reading unassigned as other", () => {
    expect(hunkMatchesFilter("retry", { plotline: "retry" })).toBe(true);
    expect(hunkMatchesFilter("tests", { plotline: "retry" })).toBe(false);
    expect(hunkMatchesFilter(undefined, { plotline: PLOTLINE_OTHER_ID })).toBe(true);
    expect(hunkMatchesFilter("retry", { plotline: PLOTLINE_OTHER_ID })).toBe(false);
  });
});

describe("hide levels (#325)", () => {
  const h = (over: Partial<Parameters<typeof shouldHideAtLevel>[0]> & { cited?: boolean; unhidden?: boolean } = {}) => ({
    added: 2, removed: 1, ...over,
  });
  it("maps each level to what it hides", () => {
    expect(shouldHideAtLevel(h({ hiddenReason: "imports" }), "all")).toBe(false);
    expect(shouldHideAtLevel(h({ hiddenReason: "imports" }), "uninteresting")).toBe(true);
    expect(shouldHideAtLevel(h({ score: "mechanical" }), "uninteresting")).toBe(false);
    expect(shouldHideAtLevel(h({ score: "mechanical" }), "routine")).toBe(true);
    expect(shouldHideAtLevel(h({ score: "routine" }), "routine")).toBe(false);
    expect(shouldHideAtLevel(h({ score: "routine" }), "substantive")).toBe(true);
    expect(shouldHideAtLevel(h({ score: "substantive" }), "substantive")).toBe(false);
    expect(shouldHideAtLevel(h({ score: "substantive" }), "needs-attention")).toBe(true);
    expect(shouldHideAtLevel(h({ score: "needs-attention" }), "needs-attention")).toBe(false);
    // Higher levels still hide uninteresting hunks.
    expect(shouldHideAtLevel(h({ hiddenReason: "imports", score: "substantive" }), "needs-attention")).toBe(true);
  });
  it("never hides unscored, one-line-uninteresting, or unhidden hunks", () => {
    expect(shouldHideAtLevel(h({}), "needs-attention")).toBe(false);
    expect(shouldHideAtLevel(h({ hiddenReason: "imports", added: 1, removed: 0 }), "uninteresting")).toBe(false);
    expect(shouldHideAtLevel(h({ hiddenReason: "imports" }), "uninteresting", { unhidden: true })).toBe(false);
    expect(normalizeHideLevel("routine")).toBe("routine");
    expect(normalizeHideLevel("bogus")).toBeNull();
    expect(normalizeHideLevel(undefined)).toBeNull();
  });
  it("counts hidden hunks with a partitioned breakdown and kept counts", () => {
    const stats = hideLevelStats([
      h({ hiddenReason: "imports", score: "mechanical" }),
      h({ score: "mechanical" }),
      h({ score: "routine" }),
      h({ score: "substantive" }),
      h({ score: "needs-attention" }),
      h({ score: "mechanical" }),
      h({ hiddenReason: "imports", unhidden: true }),
    ], "substantive");
    expect(stats).toEqual({
      total: 7, hidden: 4, uninteresting: 1, mechanical: 2, routine: 1, substantive: 0, keptShown: 1,
    });
    expect(formatHideLevelStats(stats)).toBe(
      "Hiding 4 of 7 hunks: 1 uninteresting, 2 mechanical, 1 routine · 1 kept because shown",
    );
    expect(formatHideLevelStats(hideLevelStats([], "all"))).toBe("Hiding 0 of 0 hunks");
  });
  it("maps stored levels to hidden-up-to thresholds and back", () => {
    expect(hideLevelHiddenUpTo("all")).toBe(-1);
    expect(hideLevelHiddenUpTo("uninteresting")).toBe(0);
    expect(hideLevelHiddenUpTo("routine")).toBe(1);
    expect(hideLevelHiddenUpTo("substantive")).toBe(2);
    expect(hideLevelHiddenUpTo("needs-attention")).toBe(3);
    expect(hideLevelForHiddenUpTo(-1)).toBe("all");
    expect(hideLevelForHiddenUpTo(0)).toBe("uninteresting");
    expect(hideLevelForHiddenUpTo(2)).toBe("substantive");
    expect(hideLevelForHiddenUpTo(99)).toBe("needs-attention");
  });
  it("menu clicks move the one threshold up or down (#325 redesign)", () => {
    // Shown row: hides it and everything less important.
    expect(hideLevelAfterCategoryClick("uninteresting", "routine")).toBe("substantive");
    expect(hideLevelAfterCategoryClick("all", "uninteresting")).toBe("uninteresting");
    // Most important hidden row: shows it, threshold moves down one.
    expect(hideLevelAfterCategoryClick("substantive", "routine")).toBe("routine");
    expect(hideLevelAfterCategoryClick("uninteresting", "uninteresting")).toBe("all");
    // Lower hidden row: shows it and everything more important.
    expect(hideLevelAfterCategoryClick("needs-attention", "mechanical")).toBe("uninteresting");
    // Needs attention always shows.
    expect(hideLevelAfterCategoryClick("all", "needs-attention")).toBe("all");
    expect(hideLevelAfterCategoryClick("needs-attention", "needs-attention")).toBe("needs-attention");
  });
  it("button label counts truly hidden hunks; All shown only at zero", () => {
    // The reported state, after the owner decision to drop the cited
    // exemption: threshold hides up to Routine and the two routine
    // hunks (guide-cited, but that no longer keeps them) are hidden.
    const state = hideLevelStats([
      h({ score: "routine" }), h({ score: "routine" }),
      h({ score: "substantive" }), h({ score: "substantive" }), h({ score: "substantive" }),
      h({ score: "substantive" }), h({ score: "substantive" }),
    ], "substantive");
    expect(state.hidden).toBe(2);
    expect(hideButtonLabel(state)).toBe("Hiding 2");
    // Only the user's own unhide keeps a hunk visible.
    const unhidden = hideLevelStats([h({ score: "mechanical", unhidden: true })], "routine");
    expect(hideButtonLabel(unhidden)).toBe("All shown");
    expect(hideButtonLabel(hideLevelStats([], "all"))).toBe("All shown");
  });
  it("assigns hunks to menu categories, hide reason first", () => {
    expect(hunkCategory(h({ hiddenReason: "imports", score: "substantive" }))).toBe("uninteresting");
    expect(hunkCategory(h({ hiddenReason: "imports", added: 1, removed: 0 }))).toBeNull();
    expect(hunkCategory(h({ score: "mechanical" }))).toBe("mechanical");
    expect(hunkCategory(h({}))).toBeNull();
  });
});
