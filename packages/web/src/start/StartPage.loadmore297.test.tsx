/**
 * Start-page Load more + typed author search (#297).
 *
 * - A full PR page (`hasMore`) offers "Load more PRs", which re-fetches
 *   with a doubled limit; the author list grows with the new rows.
 * - Typing a login in the author search box and pressing Enter fetches
 *   that author's PRs server-side (the `author` query option, not just
 *   the loaded rows); an empty result names the login with a way back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Repo, RepoChange, RepoChangesResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { StartPage } from "./StartPage.js";
import { __resetKeptForTests } from "./keptChanges.js";

const REPO_KEY = "unvibe.start.repoId";
const REPO: Repo = { id: "r1", owner: "acme", name: "app", localPath: "/tmp/app", lastOpened: 0 };

function pr(n: number, title: string, author: string): RepoChange {
  return { kind: "pr", title, prNumber: n, branch: `b${n}`, author, updatedAt: Date.now() };
}

type ChangesOpts = { limit?: number; author?: string };
const seen: { filter?: string; opts?: ChangesOpts }[] = [];
let requestedRows: RepoChange[] = [];
let requestedHasMore = false;

function mockPage(): void {
  seen.length = 0;
  vi.spyOn(api, "repos").mockResolvedValue({ repos: [REPO] });
  vi.spyOn(api, "reviews").mockResolvedValue({ reviews: [] });
  vi.spyOn(api, "readiness").mockResolvedValue({ checks: [], generatedAt: Date.now(), cached: false });
  vi.spyOn(api, "viewer").mockResolvedValue({ login: "you" });
  vi.spyOn(api, "createReview").mockResolvedValue({ review: { id: "rv1" } } as never);
  vi.spyOn(api, "repoChanges").mockImplementation((async (
    id: string,
    filter?: string,
    opts?: ChangesOpts,
  ): Promise<RepoChangesResponse> => {
    if (id === "demo") return { changes: [], hasMore: false };
    seen.push({ filter, opts });
    if (filter === "review-requested") {
      const rows =
        opts?.author !== undefined ? requestedRows.filter((c) => c.author === opts.author) : requestedRows;
      return { changes: rows, hasMore: requestedHasMore };
    }
    return { changes: [], hasMore: false };
  }) as typeof api.repoChanges);
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <StartPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  __resetKeptForTests();
  vi.restoreAllMocks();
});

describe("Load more PRs (#297)", () => {
  it("a full page offers Load more, which re-fetches doubled and grows the authors", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "First ask", "alice"), pr(2, "Second ask", "bob")];
    requestedHasMore = true;
    mockPage();
    renderPage();

    await screen.findByText("First ask");
    const more = await screen.findByTestId("lists-load-more");
    expect(more).toHaveTextContent("Load more PRs");

    // The next page brings a new row by a new author.
    requestedRows = [...requestedRows, pr(3, "Third ask", "carol")];
    requestedHasMore = false;
    fireEvent.click(more);
    await screen.findByText("Third ask");
    // The author list grew with the new rows.
    const author = screen.getByLabelText("Author", { exact: true });
    fireEvent.click(author);
    expect(await screen.findByRole("option", { name: "carol (1)" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // The reload re-fetched with the doubled limit.
    const limits = seen.filter((s) => s.filter === "review-requested").map((s) => s.opts?.limit);
    expect(limits).toContain(60);
    expect(screen.queryByTestId("lists-load-more")).not.toBeInTheDocument();
  });

  it("no Load more when nothing is truncated", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Only ask", "alice")];
    requestedHasMore = false;
    mockPage();
    renderPage();

    await screen.findByText("Only ask");
    expect(screen.queryByTestId("lists-load-more")).not.toBeInTheDocument();
  });
});

describe("typed author search (#297)", () => {
  it("Enter fetches that author's PRs and shows the login", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice"), pr(2, "Bob asks", "bob")];
    mockPage();
    renderPage();

    await screen.findByText("Bob asks");
    fireEvent.change(screen.getByLabelText("Search author by login"), { target: { value: "alice" } });
    fireEvent.keyDown(screen.getByLabelText("Search author by login"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByText("Bob asks")).not.toBeInTheDocument());
    expect(screen.getByText("Alice asks")).toBeInTheDocument();
    // The server saw the author option on the requested-list call.
    const authors = seen.filter((s) => s.filter === "review-requested").map((s) => s.opts?.author);
    expect(authors.at(-1)).toBe("alice");
    // The select keeps showing the typed login.
    expect(screen.getByLabelText("Author", { exact: true })).toHaveTextContent("alice");
  });

  it("an unknown login names itself with a way back, and Show all clears it", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice")];
    mockPage();
    renderPage();

    await screen.findByText("Alice asks");
    fireEvent.change(screen.getByLabelText("Search author by login"), { target: { value: "zed" } });
    fireEvent.keyDown(screen.getByLabelText("Search author by login"), { key: "Enter" });

    const empty = await screen.findByTestId("requested-author-search-empty");
    expect(empty).toHaveTextContent("No PRs by zed.");
    fireEvent.click(empty.querySelector("button") as HTMLButtonElement);
    await screen.findByText("Alice asks");
    expect(screen.getByLabelText("Author", { exact: true })).toHaveTextContent("All");
    const authors = seen.filter((s) => s.filter === "review-requested").map((s) => s.opts?.author);
    expect(authors.at(-1)).toBeUndefined();
  });
});
