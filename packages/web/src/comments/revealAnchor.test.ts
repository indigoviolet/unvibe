/**
 * Issue #364: the reverse link scrolls to the highlight mark (or the
 * margin marker's line) and flashes it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { revealThreadAnchor } from "./revealAnchor.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  if (!Element.prototype.scrollIntoView) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = vi.fn();
  }
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("revealThreadAnchor", () => {
  test("scrolls to the highlight mark and flashes it", () => {
    document.body.innerHTML =
      '<p>text <mark class="anc" data-thr="ann_1">quoted</mark> more</p>' +
      '<section id="ann_1" data-thread="ann_1"></section>';
    expect(revealThreadAnchor("ann_1")).toBe(true);
    const mark = document.querySelector('mark[data-thr="ann_1"]')!;
    expect(mark.classList.contains("flash")).toBe(true);
    expect(mark.scrollIntoView).toHaveBeenCalled();
    vi.advanceTimersByTime(2100);
    expect(mark.classList.contains("flash")).toBe(false);
  });

  test("falls back to the margin marker's line when the quote can't be placed", () => {
    document.body.innerHTML =
      '<button data-thr-margin="ann_2">icon</button>' +
      '<section id="ann_2" data-thread="ann_2"></section>';
    expect(revealThreadAnchor("ann_2")).toBe(true);
    const margin = document.querySelector('[data-thr-margin="ann_2"]')!;
    expect(margin.classList.contains("flash")).toBe(true);
    expect(margin.scrollIntoView).toHaveBeenCalled();
  });

  test("falls back to the thread itself when nothing is placed", () => {
    document.body.innerHTML = '<section id="ann_3" data-thread="ann_3"></section>';
    expect(revealThreadAnchor("ann_3")).toBe(false);
    expect(document.getElementById("ann_3")!.scrollIntoView).toHaveBeenCalled();
  });
});
