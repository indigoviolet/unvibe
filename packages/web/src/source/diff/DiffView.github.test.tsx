/**
 * Existing GitHub comments in the diff (issue #168) against the mock API
 * (`VITE_MOCK=1`): current threads collapsed under their line, outdated
 * threads at their file's top, removed-file threads in the end section,
 * and the filter-menu show/hide control persisted with the review.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useReview } from "../../state/store.js";
import { resetMockState, setMockLatency } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  setMockLatency(0);
  useReview.getState().clear();
});

afterEach(() => {
  setMockLatency(null);
  cleanup();
});

async function renderDiff(): Promise<void> {
  render(<DiffView reviewId="demo" />);
  await screen.findByText("connection.py", {}, { timeout: 3000 });
}

/** Issue #296: new reviews hide existing comments; show them like a reviewer would. */
async function showGithubComments(): Promise<void> {
  await fireEvent.click(screen.getByRole("button", { name: "Review filters" }));
  await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /GitHub comments/ }));
  await screen.findByText("teammate · 2 comments");
}

const CONN = "src-urllib3-connection.py";

function connSection(): HTMLElement {
  const el = document.getElementById(`F-${CONN}`);
  if (!el) throw new Error(`missing #F-${CONN}`);
  return el;
}

describe("DiffView GitHub threads", () => {
  it("renders the current thread collapsed under its line", async () => {
    await renderDiff();
    await showGithubComments();
    const conn = within(connSection());
    expect(conn.getByText("teammate · 2 comments")).toBeInTheDocument();
    expect(conn.getAllByText("from GitHub")).toHaveLength(2);
    const line = document.getElementById("gh-thread-101");
    if (!line) throw new Error("missing #gh-thread-101");
    // The thread sits in the slot row directly under its diff line.
    expect(line.closest("tr")?.previousElementSibling?.id).toBe(`L-${CONN}-82`);
    const thread = within(line);
    // Bodies stay hidden until expanded.
    expect(thread.queryByText(/consider covering bare LF/)).not.toBeInTheDocument();
    await fireEvent.click(thread.getByRole("button", { name: "Expand comments from teammate" }));
    expect(await thread.findByText(/consider covering bare LF/)).toBeInTheDocument();
    expect(thread.getByText(/the fast path only checks/)).toBeInTheDocument();
    expect(thread.getAllByText("Open on GitHub")).toHaveLength(2);
    await fireEvent.click(thread.getByRole("button", { name: "Collapse comments from teammate" }));
    await waitFor(() => expect(thread.queryByText(/consider covering bare LF/)).not.toBeInTheDocument());
  });

  it("lists outdated threads at their file's top and removed-file threads at the end", async () => {
    await renderDiff();
    await showGithubComments();
    const conn = within(connSection());
    expect(conn.getByText("GitHub comments on lines no longer in the diff")).toBeInTheDocument();
    expect(conn.getByText("teammate · 1 comment")).toBeInTheDocument();
    expect(screen.getByText("GitHub comments on files no longer in the diff")).toBeInTheDocument();
    expect(screen.getByText("review-bot · 1 comment")).toBeInTheDocument();
  });

  it("starts hidden; the filter menu shows and re-hides them, remembered with the review", async () => {
    await renderDiff();
    // New reviews hide existing comments (#296).
    expect(screen.queryByText("teammate · 2 comments")).not.toBeInTheDocument();
    expect(useReview.getState().snapshot?.viewPrefs.showExistingComments).toBe(false);
    // ...show them through the filter menu...
    await fireEvent.click(screen.getByRole("button", { name: "Review filters" }));
    await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /GitHub comments/ }));
    await waitFor(() => expect(screen.getByText("teammate · 2 comments")).toBeInTheDocument());
    expect(useReview.getState().snapshot?.viewPrefs.showExistingComments).toBe(true);
    // ...and back off again.
    await fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /GitHub comments/ }));
    await waitFor(() => expect(screen.queryByText("teammate · 2 comments")).not.toBeInTheDocument());
    expect(screen.queryByText("GitHub comments on lines no longer in the diff")).not.toBeInTheDocument();
    expect(useReview.getState().snapshot?.viewPrefs.showExistingComments).toBe(false);
  });
});
