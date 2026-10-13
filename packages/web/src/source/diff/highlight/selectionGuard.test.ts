/**
 * Selection-guard tests (issue #23, hardening item 5): highlight upgrades
 * swap text nodes for spans, so they wait while a diff selection is live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDiffSelectionActive, waitForSelectionClear } from "./selectionGuard.js";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

function mountDiffCell(text: string): Text {
  const right = document.createElement("div");
  right.id = "right";
  right.innerHTML = `<table class="diff"><tbody><tr><td class="c">${text}</td></tr></tbody></table>`;
  document.body.appendChild(right);
  const cell = right.querySelector("td.c")!;
  return cell.firstChild as Text;
}

function select(node: Text, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("isDiffSelectionActive", () => {
  it("is false with no selection", () => {
    mountDiffCell("hello world");
    expect(isDiffSelectionActive()).toBe(false);
  });

  it("is false for a collapsed caret in diff code", () => {
    const node = mountDiffCell("hello world");
    select(node, 2, 2);
    expect(isDiffSelectionActive()).toBe(false);
  });

  it("is true for a live selection inside diff code", () => {
    const node = mountDiffCell("hello world");
    select(node, 0, 5);
    expect(isDiffSelectionActive()).toBe(true);
  });

  it("is false for a selection outside the diff pane", () => {
    const p = document.createElement("p");
    p.textContent = "guide text here";
    document.body.appendChild(p);
    select(p.firstChild as Text, 0, 5);
    expect(isDiffSelectionActive()).toBe(false);
  });
});

describe("waitForSelectionClear", () => {
  // Fake timers for the 120 ms poll ticks (issue #119).
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when no diff selection is live", async () => {
    mountDiffCell("hello world");
    await waitForSelectionClear(undefined, undefined, 50);
  });

  it("resolves once the selection collapses", async () => {
    const node = mountDiffCell("hello world");
    select(node, 0, 5);
    const done = waitForSelectionClear(undefined, undefined, 5000);
    window.getSelection()?.removeAllRanges();
    await vi.advanceTimersByTimeAsync(120);
    await done;
  });

  it("is bounded: resolves on timeout when the selection stays", async () => {
    const node = mountDiffCell("hello world");
    select(node, 0, 5);
    let resolved = false;
    const done = waitForSelectionClear(undefined, undefined, 150).then(() => {
      resolved = true;
    });
    // First tick is at 120 ms: not resolved before then…
    await vi.advanceTimersByTimeAsync(119);
    expect(resolved).toBe(false);
    // …tick at 120 re-arms (120 < 150), tick at 240 times out.
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(true);
    await done;
    // The selection itself is untouched (the upgrade still lands).
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("resolves when cancelled", async () => {
    const node = mountDiffCell("hello world");
    select(node, 0, 5);
    let cancelled = false;
    const done = waitForSelectionClear(
      undefined,
      () => cancelled,
      5000,
    );
    cancelled = true;
    await vi.advanceTimersByTimeAsync(120);
    await done;
  });
});
