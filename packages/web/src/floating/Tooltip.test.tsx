/** Tooltip: delayed open + PRD §4.5 dismissal rules. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip.js";

function tip(): HTMLElement {
  const el = document.getElementById("tip");
  if (!el) throw new Error("missing #tip");
  return el;
}

function move(x: number): void {
  const ev = new MouseEvent("pointermove", { bubbles: true });
  Object.defineProperty(ev, "movementX", { value: x });
  Object.defineProperty(ev, "movementY", { value: 0 });
  document.dispatchEvent(ev);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("opens after a pause, closes on Escape", () => {
    render(
      <div>
        <button type="button" data-tip="tip text">
          hover me
        </button>
        <Tooltip />
      </div>,
    );
    fireEvent.mouseOver(screen.getByText("hover me"));
    expect(tip().hidden).toBe(true);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toBe("tip text");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip().hidden).toBe(true);
  });

  it("closes on scroll and ignores hover until the pointer really moves", () => {
    render(
      <div>
        <button type="button" data-tip="tip text">
          hover me
        </button>
        <Tooltip />
      </div>,
    );
    const btn = screen.getByText("hover me");
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tip().hidden).toBe(false);
    fireEvent.scroll(document);
    expect(tip().hidden).toBe(true);
    // Content sliding under a stationary cursor must not re-open.
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tip().hidden).toBe(true);
    // A real move re-arms hover.
    act(() => {
      move(4);
    });
    fireEvent.mouseOver(btn);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tip().hidden).toBe(false);
  });

  it("closes on blur and resize", () => {
    render(
      <div>
        <button type="button" data-tip="tip text">
          hover me
        </button>
        <Tooltip />
      </div>,
    );
    fireEvent.mouseOver(screen.getByText("hover me"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tip().hidden).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(tip().hidden).toBe(true);
    fireEvent.mouseOver(screen.getByText("hover me"));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(tip().hidden).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(tip().hidden).toBe(true);
  });
});
