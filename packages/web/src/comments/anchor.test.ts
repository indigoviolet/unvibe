import { describe, expect, test, vi } from "vitest";
import {
  anchorScope,
  highlightAnchorInRoot,
  locateQuoteSegments,
  markTextInElement,
  placeAnchorSpot,
  repassUntilSettled,
  selectionOffsetsIn,
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
      highlightAnchorInRoot(root, "b1", { quote }, () => makeExpMark("e1", false));
    }
    expect(maxMarkDepth(root)).toBe(1);
    expect(root.querySelectorAll('mark.anc[data-jump="e1"]').length).toBe(2);
  });

  test("repeated highlight passes do not nest thread marks", () => {
    const { root } = hostWithQuote("<p>the fast path wins</p>", "b1");
    for (let i = 0; i < 5; i++) {
      highlightAnchorInRoot(root, "b1", { quote: "fast path" }, () => makeThreadMark("t1"));
    }
    expect(maxMarkDepth(root)).toBe(1);
    expect(root.querySelectorAll('mark.anc[data-thr="t1"]').length).toBe(1);
  });

  test("open -> closed re-mark updates the class without nesting", () => {
    const { root } = hostWithQuote("<p>the fast path wins</p>", "b1");
    highlightAnchorInRoot(root, "b1", { quote: "fast path" }, () => makeExpMark("e1", false));
    expect(root.querySelector("mark.anc")?.className).toBe("anc ex");
    highlightAnchorInRoot(root, "b1", { quote: "fast path" }, () => makeExpMark("e1", true));
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
      highlightAnchorInRoot(root, "b1", { quote: "fast path" }, () => makeThreadMark("t1"));
      highlightAnchorInRoot(root, "b1", { quote: "slow lane" }, () => makeExpMark("e1", true));
    }
    expect(maxMarkDepth(root)).toBe(1);
  });
});

describe("anchorScope (#78)", () => {
  test("a card#block anchor marks only its own card when block ids repeat", () => {
    const root = document.createElement("div");
    root.innerHTML =
      `<section id="C-problem"><p data-top="b1">uses the receiver</p></section>` +
      `<section id="C-central"><p data-top="b1">the receiver again</p></section>`;
    const make = (): HTMLElement => makeExpMark("ann_1", false);
    expect(
      highlightAnchorInRoot(anchorScope(root, "central#b1"), "b1", { quote: "receiver" }, make),
    ).toBe(true);
    expect(root.querySelector("#C-problem mark")).toBeNull();
    expect(root.querySelector("#C-central mark")?.textContent).toBe("receiver");
    // Bare ids and unknown cards search the whole root.
    expect(anchorScope(root, "b1")).toBe(root);
    expect(anchorScope(root, "gone#b1")).toBe(root);
  });
});

describe("offset placement (issue #166)", () => {
  test("a quote occurring twice places at the recorded offsets, not the first match", () => {
    const { host } = hostWithQuote("<p>the fast path and the fast path</p>", "b1");
    const make = (): HTMLElement => makeExpMark("e1", false);
    // Second occurrence: "the fast path and " is 18 chars.
    expect(placeAnchorSpot(host, { quote: "fast path", startOffset: 18, endOffset: 27 }, make)).toBe(1);
    const marks = host.querySelectorAll("mark.anc");
    expect(marks).toHaveLength(1);
    // The mark sits on the second occurrence: "and the " precedes it.
    const before = marks[0].previousSibling?.textContent ?? "";
    expect(before).toContain("and the ");
  });

  test("offsets out of range fall back to the nearest text match", () => {
    const { host } = hostWithQuote("<p>the fast path and the fast path</p>", "b1");
    const make = (): HTMLElement => makeExpMark("e1", false);
    // Stale offsets (text was longer at selection): nearest match wins.
    expect(placeAnchorSpot(host, { quote: "fast path", startOffset: 200, endOffset: 209 }, make)).toBe(1);
    expect(host.querySelectorAll("mark.anc")).toHaveLength(1);
  });

  test("a changed block falls back to the occurrence nearest the old offsets", () => {
    const { host } = hostWithQuote("<p>prefix words then the fast path and the fast path tail</p>", "b1");
    const make = (): HTMLElement => makeExpMark("e1", false);
    // Recorded near the end, but the recorded slice no longer matches.
    expect(placeAnchorSpot(host, { quote: "fast path", startOffset: 60, endOffset: 69 }, make)).toBe(1);
    const marks = host.querySelectorAll("mark.anc");
    expect(marks).toHaveLength(1);
    const before = marks[0].previousSibling?.textContent ?? "";
    expect(before).toContain("and the ");
  });

  test("without offsets the first occurrence wins (today's behaviour)", () => {
    const { host } = hostWithQuote("<p>the fast path and the fast path</p>", "b1");
    const make = (): HTMLElement => makeExpMark("e1", false);
    expect(placeAnchorSpot(host, { quote: "fast path" }, make)).toBe(1);
    const marks = host.querySelectorAll("mark.anc");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("fast path");
    // First occurrence: only "the " precedes the mark.
    expect(marks[0].previousSibling?.textContent).toBe("the ");
  });

  test("a missing quote places nothing", () => {
    const { host } = hostWithQuote("<p>something else entirely</p>", "b1");
    const make = (): HTMLElement => makeExpMark("e1", false);
    expect(placeAnchorSpot(host, { quote: "fast path", startOffset: 4, endOffset: 13 }, make)).toBe(0);
    expect(host.querySelectorAll("mark.anc")).toHaveLength(0);
  });
});

describe("own-host scoping (issue #166)", () => {
  function nestedRoot(): { root: HTMLDivElement; scope: Element } {
    const root = document.createElement("div");
    root.innerHTML =
      `<section class="ui-card" id="C-outer">` +
      `<p class="prose sel" data-top="b1">alpha beta gamma</p>` +
      `<section class="ui-card child" id="B-inner" data-expansion="inner">` +
      `<p class="prose sel" data-top="b1">alpha beta gamma</p>` +
      `</section></section>`;
    return { root, scope: root.querySelector("#C-outer")! };
  }

  test("a mark lands only in its own host block, never a nested card", () => {
    const { root, scope } = nestedRoot();
    const make = (): HTMLElement => makeExpMark("e1", false);
    expect(highlightAnchorInRoot(scope, "b1", { quote: "beta", startOffset: 6, endOffset: 10 }, make)).toBe(true);
    const marks = root.querySelectorAll("mark.anc");
    expect(marks).toHaveLength(1);
    expect(root.querySelector("#B-inner mark")).toBeNull();
    expect(marks[0].textContent).toBe("beta");
  });

  test("when the own block's text changed, no mark leaks into the nested card", () => {
    const { root, scope } = nestedRoot();
    // Outer text rewritten without the quote; the nested copy still has it.
    root.querySelector("#C-outer > p")!.textContent = "alpha gamma delta";
    const make = (): HTMLElement => makeExpMark("e1", false);
    expect(highlightAnchorInRoot(scope, "b1", { quote: "beta", startOffset: 6, endOffset: 10 }, make)).toBe(false);
    expect(root.querySelectorAll("mark.anc")).toHaveLength(0);
  });
});

describe("repass until settled (issue #166)", () => {
  test("an unplaced anchor is retried and lands once the host re-renders", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      root.innerHTML = `<div data-top="b1"><p>not there yet</p></div>`;
      const host = root.querySelector("[data-top]") as HTMLElement;
      const make = (): HTMLElement => makeExpMark("e1", false);
      const spot = { quote: "fast path", startOffset: 0, endOffset: 9 };
      let placed = placeAnchorSpot(host, spot, make) > 0;
      const repass = vi.fn(() => {
        placed = placeAnchorSpot(host, spot, make) > 0;
      });
      const cancel = repassUntilSettled(() => placed, repass, 3, 250);
      expect(placed).toBe(false);
      // The host re-renders with the phrase (no new pass triggered).
      host.querySelector("p")!.textContent = "the fast path wins";
      vi.advanceTimersByTime(250);
      expect(repass).toHaveBeenCalled();
      expect(placed).toBe(true);
      expect(host.querySelector("mark.anc")?.textContent).toBe("fast path");
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retries stop once settled or out of attempts", () => {
    vi.useFakeTimers();
    try {
      const repass = vi.fn();
      const cancelSettled = repassUntilSettled(() => true, repass, 3, 250);
      vi.advanceTimersByTime(1000);
      expect(repass).not.toHaveBeenCalled();
      cancelSettled();
      const repass2 = vi.fn();
      repassUntilSettled(() => false, repass2, 2, 250);
      vi.advanceTimersByTime(1000);
      expect(repass2).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selectionOffsetsIn (issue #166)", () => {
  test("reads a single-node selection as host-text offsets", () => {
    const { root, host } = hostWithQuote("<p>the fast path wins</p>", "b1");
    document.body.appendChild(root);
    try {
      const text = host.querySelector("p")!.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, 4);
      range.setEnd(text, 13);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        expect(selectionOffsetsIn(host, sel)).toEqual({ start: 4, end: 13 });
      } finally {
        sel.removeAllRanges();
      }
    } finally {
      root.remove();
    }
  });

  test("null for collapsed selections and selections outside the host", () => {
    const { host } = hostWithQuote("<p>the fast path wins</p>", "b1");
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    expect(selectionOffsetsIn(host, sel)).toBeNull();
    const other = document.createElement("p");
    other.textContent = "elsewhere";
    document.body.appendChild(other);
    try {
      const text = other.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      sel.removeAllRanges();
      sel.addRange(range);
      expect(selectionOffsetsIn(host, sel)).toBeNull();
    } finally {
      sel.removeAllRanges();
      other.remove();
    }
  });
});
