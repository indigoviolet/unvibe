/** Toast: replace-on-new + auto-dismiss. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Toast, toast } from "./Toast.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function toastEl(): HTMLElement {
  const el = document.getElementById("toast");
  if (!el) throw new Error("missing #toast");
  return el;
}

describe("Toast", () => {
  it("shows a toast and auto-dismisses after 2.6 s", () => {
    render(<Toast />);
    expect(toastEl().hidden).toBe(true);
    act(() => {
      toast("hello");
    });
    expect(screen.getByText("hello")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(toastEl().hidden).toBe(true);
  });

  it("replaces the current toast and restarts the timer", () => {
    render(<Toast />);
    act(() => {
      toast("one");
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      toast("two");
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Under the first toast's timer this would already be gone.
    expect(screen.getByText("two")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(toastEl().hidden).toBe(true);
  });
});
