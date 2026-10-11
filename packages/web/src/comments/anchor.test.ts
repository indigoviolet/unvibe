import { describe, expect, test } from "vitest";
import {
  highlightAnchorInRoot,
  locateQuoteSegments,
  markTextInElement,
  splitOnQuote,
} from "./anchor.js";

function makeExpMark(id: string, closed: boolean): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = closed ? "anc exl" : "anc ex";
  mark.dataset.jump = id;
  return mark;
}

function makeThreadMark(threadId: string): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "anc";
  mark.dataset.thr = threadId;
  return mark;
}

/** Deepest nesting of `mark.anc` inside `root` (1 = flat, >1 = nested layers). */
function maxMarkDepth(root: ParentNode): number {
  let depth = 0;
  for (const mark of root.querySelectorAll("mark.anc")) {
    let d = 1;
    let el: Element | null = mark.parentElement;
    while (el) {
      if (el.tagName === "MARK" && el.classList.contains("anc")) d++;
      el = el.parentElement;
    }
    if (d > depth) depth = d;
  }
  return depth;
}

function hostWithQuote(html: string, top: string): { root: HTMLDivElement; host: HTMLElement } {
  const root = document.createElement("div");
  root.innerHTML = `<div data-top="${top}">${html}</div>`;
  const host = root.querySelector(`[data-top="${top}"]`) as HTMLElement;
  return { root, host };
}

describe("locateQuoteSegments", () => {
  test("finds a quote inside one node", () => {
    expect(locateQuoteSegments(["hello world"], "world")).toEqual([
      { node: 0, start: 6, end: 11 },
    ]);
  });

  test("returns null when the anchor text is gone (marker fallback)", () => {
    expect(locateQuoteSegments(["hello world"], "missing")).toBeNull();
    expect(locateQuoteSegments(["hello"], "")).toBeNull();
  });

  test("spans inline code across text nodes", () => {
    // `before <code>foo</code> bar after` -> texts ["before ", "foo", " bar after"]
    const texts = ["before ", "foo", " bar after"];
    expect(locateQuoteSegments(texts, "foo bar")).toEqual([
      { node: 1, start: 0, end: 3 },
      { node: 2, start: 0, end: 4 },
    ]);
  });

  test("first occurrence wins when several threads share a block", () => {
    const segments = locateQuoteSegments(["fast path and fast path"], "fast path");
    expect(segments?.[0]).toEqual({ node: 0, start: 0, end: 9 });
  });
});

describe("splitOnQuote", () => {
  test("splits around the quote", () => {
    expect(splitOnQuote("a fast path b", "fast path")).toEqual({
      before: "a ",
      match: "fast path",
      after: " b",
    });
  });

  test("null when absent", () => {
    expect(splitOnQuote("abc", "z")).toBeNull();
  });
});

describe("mark idempotence (issue #15)", () => {
  test("repeated highlight passes do not nest expansion marks", () => {
    const { root } = hostWithQuote("<p>before <code>foo</code> bar after</p>", "b1");
    const quote = "foo bar";
    const N = 8;
    for (let i = 0; i < N; i++) {
      highlightAnchorInRoot(root, "b1", quote, () => makeExpMark("e1", false));
    }
    expect(maxMarkDepth(root)).toBe(1);
    expect(root.querySelectorAll('mark.anc[data-jump="e1"]').length).toBe(2);
  });

  test("repeated highlight passes do not nest thread marks", () => {
    const { root } = hostWithQuote("<p>the fast path wins</p>", "b1");
    for (let i = 0; i < 5; i++) {
      highlightAnchorInRoot(root, "b1", "fast path", () => makeThreadMark("t1"));
    }
    expect(maxMarkDepth(root)).toBe(1);
    expect(root.querySelectorAll('mark.anc[data-thr="t1"]').length).toBe(1);
  });

  test("open -> closed re-mark updates the class without nesting", () => {
    const { root } = hostWithQuote("<p>the fast path wins</p>", "b1");
    highlightAnchorInRoot(root, "b1", "fast path", () => makeExpMark("e1", false));
    expect(root.querySelector("mark.anc")?.className).toBe("anc ex");
    highlightAnchorInRoot(root, "b1", "fast path", () => makeExpMark("e1", true));
    expect(maxMarkDepth(root)).toBe(1);
    expect(root.querySelector("mark.anc")?.className).toBe("anc exl");
  });

  test("stale quotes leave no marks behind (fallback shows instead)", () => {
    const { root, host } = hostWithQuote("<p>the fast path wins</p>", "b1");
    expect(markTextInElement(host, "fast path", () => makeExpMark("e1", false))).toBe(1);
    // The quote is edited away; re-marking must clear the stale mark.
    host.textContent = "something else entirely";
    expect(markTextInElement(host, "fast path", () => makeExpMark("e1", false))).toBe(0);
    expect(root.querySelectorAll("mark.anc").length).toBe(0);
  });

  test("thread and expansion marks for different quotes coexist flat", () => {
    const { root } = hostWithQuote("<p>the fast path and the slow lane</p>", "b1");
    for (let i = 0; i < 3; i++) {
      highlightAnchorInRoot(root, "b1", "fast path", () => makeThreadMark("t1"));
      highlightAnchorInRoot(root, "b1", "slow lane", () => makeExpMark("e1", true));
    }
    expect(maxMarkDepth(root)).toBe(1);
  });
});
