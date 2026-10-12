/**
 * BrowseFolderButton (#26): picked → onPick, cancelled → nothing,
 * unavailable → inline reason hint, plus a busy state while open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PickFolderResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { BrowseFolderButton } from "./BrowseFolderButton.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function clickBrowse(): void {
  fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
}

describe("BrowseFolderButton", () => {
  it("calls onPick with the chosen path and shows no hint", async () => {
    const onPick = vi.fn();
    vi.spyOn(api, "pickFolder").mockResolvedValue({ status: "picked", path: "/a/b" });
    render(<BrowseFolderButton onPick={onPick} />);
    clickBrowse();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("/a/b"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Browse…" })).toBeEnabled();
  });

  it("does nothing on cancel", async () => {
    const onPick = vi.fn();
    let resolvePick!: (res: PickFolderResponse) => void;
    const gate = new Promise<PickFolderResponse>((resolve) => {
      resolvePick = resolve;
    });
    vi.spyOn(api, "pickFolder").mockReturnValue(gate);
    render(<BrowseFolderButton onPick={onPick} />);
    clickBrowse();
    // The round-trip completes (busy clears) with no pick and no hint.
    expect(await screen.findByRole("button", { name: "Choosing…" })).toBeDisabled();
    resolvePick({ status: "cancelled" });
    expect(await screen.findByRole("button", { name: "Browse…" })).toBeEnabled();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reason as an inline hint on unavailable", async () => {
    const onPick = vi.fn();
    vi.spyOn(api, "pickFolder").mockResolvedValue({
      status: "unavailable",
      reason: "no folder dialog tool found (install zenity or kdialog); type the path instead",
    });
    render(<BrowseFolderButton onPick={onPick} />);
    clickBrowse();
    expect(await screen.findByRole("status")).toHaveTextContent("no folder dialog tool found");
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Browse…" })).toBeEnabled();
  });

  it("shows a busy state while the dialog is open", async () => {
    const onPick = vi.fn();
    let resolvePick!: (res: PickFolderResponse) => void;
    const gate = new Promise<PickFolderResponse>((resolve) => {
      resolvePick = resolve;
    });
    vi.spyOn(api, "pickFolder").mockReturnValue(gate);
    render(<BrowseFolderButton onPick={onPick} />);
    clickBrowse();
    expect(await screen.findByRole("button", { name: "Choosing…" })).toBeDisabled();
    resolvePick({ status: "picked", path: "/x" });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("/x"));
    expect(await screen.findByRole("button", { name: "Browse…" })).toBeEnabled();
  });
});
