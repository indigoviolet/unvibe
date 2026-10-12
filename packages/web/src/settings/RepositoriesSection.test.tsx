/**
 * RepositoriesSection + BrowseFolderButton (#26): Browse fills the path
 * field (Add by path still applies it); an unavailable result shows the
 * reason while the field stays usable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../api/client.js";
import { RepositoriesSection } from "./RepositoriesSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderSection(): Promise<void> {
  vi.spyOn(api, "repos").mockResolvedValue({ repos: [] });
  render(<RepositoriesSection />);
  await screen.findByLabelText("Add a repo by path");
}

describe("RepositoriesSection folder picker", () => {
  it("Browse fills the path field; Add by path still applies it", async () => {
    const addRepo = vi.spyOn(api, "addRepo").mockResolvedValue({ repos: [] });
    vi.spyOn(api, "pickFolder").mockResolvedValue({ status: "picked", path: "/picked/repo" });
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(await screen.findByDisplayValue("/picked/repo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add by path" }));
    await waitFor(() => expect(addRepo).toHaveBeenCalledWith({ path: "/picked/repo" }));
  });

  it("unavailable shows the reason and leaves the field usable", async () => {
    vi.spyOn(api, "pickFolder").mockResolvedValue({
      status: "unavailable",
      reason: "no folder dialog tool found (install zenity or kdialog); type the path instead",
    });
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(await screen.findByText(/no folder dialog tool found/)).toBeInTheDocument();
    const input = screen.getByLabelText("Add a repo by path");
    fireEvent.change(input, { target: { value: "/typed/repo" } });
    expect(input).toHaveValue("/typed/repo");
  });
});
