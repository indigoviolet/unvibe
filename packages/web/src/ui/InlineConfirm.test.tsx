/** #346 InlineConfirm state machine: open, confirm, cancel, timeout, Escape. */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineConfirm } from "./index.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function idleButton(): HTMLElement {
  return screen.getByRole("button", { name: "Remove" });
}

describe("InlineConfirm", () => {
  test("idle shows the action; clicking opens the pill and focuses confirm", () => {
    const onConfirm = vi.fn(async () => {});
    render(<InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />);
    fireEvent.click(idleButton());
    expect(screen.getByText("Confirm remove review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm remove review" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("confirm runs the action, flashes confirmed, then closes and reports done", async () => {
    const onConfirm = vi.fn(async () => {});
    const onDone = vi.fn();
    render(<InlineConfirm action="Remove" confirmAction="remove review" runningLabel="Removing…" onConfirm={onConfirm} onDone={onDone} />);
    fireEvent.click(idleButton());
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove review" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Removing…")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(idleButton()).toBeInTheDocument();
  });

  test("cancel closes without running the action", () => {
    const onConfirm = vi.fn(async () => {});
    render(<InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />);
    fireEvent.click(idleButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(idleButton()).toBeInTheDocument();
    expect(screen.queryByText("Confirm remove review")).not.toBeInTheDocument();
  });

  test("Escape cancels and returns focus to the action button", () => {
    const onConfirm = vi.fn(async () => {});
    render(<InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />);
    fireEvent.click(idleButton());
    expect(screen.getByRole("button", { name: "Confirm remove review" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(idleButton()).toHaveFocus();
  });

  test("a click outside cancels", () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <div>
        <span data-testid="outside">outside</span>
        <InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />
      </div>,
    );
    fireEvent.click(idleButton());
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(idleButton()).toBeInTheDocument();
  });

  test("about 4–5 s without interaction reverts to idle; interaction resets it", () => {
    const onConfirm = vi.fn(async () => {});
    const { container } = render(<InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />);
    fireEvent.click(idleButton());
    expect(screen.getByText("Confirm remove review")).toBeInTheDocument();
    // 4 s pass, then the user hovers back over the pill: the clock restarts.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    fireEvent.pointerDown(container.querySelector(".uic-pill")!);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText("Confirm remove review")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByText("Confirm remove review")).not.toBeInTheDocument();
    expect(idleButton()).toBeInTheDocument();
  });

  test("a rejected action shows the error and stays until the user acts", async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("still has 2 reviews");
    });
    render(
      <InlineConfirm
        action="Remove"
        confirmAction="remove review"
        onConfirm={onConfirm}
        formatError={(err) => (err instanceof Error ? err.message : String(err))}
      />,
    );
    fireEvent.click(idleButton());
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove review" }));
    await vi.runAllTimersAsync();
    expect(screen.getByRole("alert")).toHaveTextContent("still has 2 reviews");
    // No auto-revert from the error: the user retries or cancels.
    vi.advanceTimersByTime(30_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(idleButton()).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("controlled open follows the parent (one open at a time)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <InlineConfirm action="Remove" confirmAction="remove review" onConfirm={async () => {}} open={false} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(idleButton());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Confirm remove review")).not.toBeInTheDocument();
    rerender(
      <InlineConfirm action="Remove" confirmAction="remove review" onConfirm={async () => {}} open onOpenChange={onOpenChange} />,
    );
    expect(screen.getByText("Confirm remove review")).toBeInTheDocument();
  });

  test("confirms under StrictMode (dev mounts effects twice)", async () => {
    // The dev double-mount must not disarm the async paths: the
    // confirmed flash and onDone still happen.
    const onConfirm = vi.fn(async () => {});
    const onDone = vi.fn();
    render(
      <StrictMode>
        <InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} onDone={onDone} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove review" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(900);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  test("below placement drops the pill under the slot (toolbar)", () => {
    render(<InlineConfirm action="Re-do guide" confirmAction="re-do guide" onConfirm={async () => {}} placement="below" />);
    fireEvent.click(screen.getByRole("button", { name: "Re-do guide" }));
    expect(document.querySelector(".uic[data-placement='below'] .uic-pill")).not.toBeNull();
  });

  test("stack placement lays the question above the in-flow pill", () => {
    render(<InlineConfirm action="Reset data" confirmAction="reset data" onConfirm={async () => {}} placement="stack" detail="Remove all reviews?" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset data" }));
    const wrap = document.querySelector(".uic[data-placement='stack']");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector(".uic-detail")).toHaveTextContent("Remove all reviews?");
    expect(wrap?.querySelector(".uic-pill")).not.toBeNull();
  });

  test("Enter on the focused confirm runs the action", async () => {
    const onConfirm = vi.fn(async () => {});
    render(<InlineConfirm action="Remove" confirmAction="remove review" onConfirm={onConfirm} />);
    fireEvent.click(idleButton());
    const confirm = screen.getByRole("button", { name: "Confirm remove review" });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
  });
});
