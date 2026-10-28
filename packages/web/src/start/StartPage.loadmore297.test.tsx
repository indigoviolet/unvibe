/**
 * Start-page Load more + author combobox (#297, combobox follow-up).
 *
 * - A full PR page (`hasMore`) offers "Load more PRs", which re-fetches
 *   with a doubled limit; the author list grows with the new rows.
 * - The single author combobox shows the choice at rest; typing filters
 *   the known authors and picking one applies the client-side filter;
 *   Enter on a login that isn't listed fetches that author's PRs
 *   server-side (the `author` query option); an empty result names the
 *   login with a way back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Repo, RepoChange, RepoChangesResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { StartPage } from "./StartPage.js";
import { __resetKeptForTests, getKeptLists } from "./keptChanges.js";

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
      // diana's PR lives only on the server: it answers `--author diana`.
      const rows =
        opts?.author !== undefined
          ? [
              ...requestedRows.filter((c) => c.author === opts.author),
              ...(opts.author === "diana" ? [pr(9, "Diana's ask", "diana")] : []),
            ]
          : requestedRows;
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

function authorInput(): HTMLElement {
  return screen.getByLabelText("Author", { exact: true });
}

/** Open the combobox popup: Base UI opens on pointer press, not click. */
async function openCombo(): Promise<void> {
  const input = authorInput();
  fireEvent.pointerDown(input, { pointerType: "mouse" });
  fireEvent.mouseDown(input);
  fireEvent.pointerUp(input, { pointerType: "mouse" });
  fireEvent.mouseUp(input);
  fireEvent.click(input);
  await screen.findByRole("listbox");
}

function requestedAuthors(): (string | undefined)[] {
  return seen.filter((s) => s.filter === "review-requested").map((s) => s.opts?.author);
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
    expect(authorInput()).toHaveValue("All");
    await openCombo();
    expect(await screen.findByRole("option", { name: "carol (1)" })).toBeInTheDocument();
    fireEvent.keyDown(authorInput(), { key: "Escape" });
    expect(authorInput()).toHaveValue("All");
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

describe("author combobox (#297 follow-up)", () => {
  it("typing filters the known authors; Escape drops the draft", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice"), pr(2, "Bob asks", "bob"), pr(3, "Second bob", "bob")];
    mockPage();
    renderPage();

    await screen.findByText("Alice asks");
    expect(authorInput()).toHaveValue("All");
    // ArrowDown opens the full list (jsdom change events carry no
    // inputType, so they never open it on their own — real typing does).
    fireEvent.keyDown(authorInput(), { key: "ArrowDown" });
    expect(await screen.findByRole("option", { name: "alice (1)" })).toBeInTheDocument();
    fireEvent.change(authorInput(), { target: { value: "car" } });
    // No carol in the lists yet: the dropdown empties with the Enter hint.
    expect(await screen.findByText(/press Enter to search GitHub/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /alice/ })).not.toBeInTheDocument();
    // Escape closes and drops the draft: the box shows the choice again.
    fireEvent.keyDown(authorInput(), { key: "Escape" });
    expect(authorInput()).toHaveValue("All");
    // Typing alone fetched nothing.
    expect(requestedAuthors().every((a) => a === undefined)).toBe(true);
  });

  it("picking a listed login applies the client-side filter", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice"), pr(2, "Bob asks", "bob")];
    mockPage();
    renderPage();

    await screen.findByText("Bob asks");
    fireEvent.change(authorInput(), { target: { value: "alice" } });
    fireEvent.keyDown(authorInput(), { key: "Enter" });

    await waitFor(() => expect(screen.queryByText("Bob asks")).not.toBeInTheDocument());
    expect(screen.getByText("Alice asks")).toBeInTheDocument();
    // A listed login filters client-side: no server search was sent.
    expect(requestedAuthors().every((a) => a === undefined)).toBe(true);
    expect(authorInput()).toHaveValue("alice (1)");
  });

  it("Enter on an unlisted login fetches that author's PRs", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice"), pr(2, "Bob asks", "bob")];
    mockPage();
    renderPage();

    await screen.findByText("Bob asks");
    fireEvent.change(authorInput(), { target: { value: "diana" } });
    fireEvent.keyDown(authorInput(), { key: "Enter" });

    await screen.findByText("Diana's ask");
    expect(screen.queryByText("Alice asks")).not.toBeInTheDocument();
    expect(requestedAuthors().at(-1)).toBe("diana");
    // The fetched login joins the known authors, with its count.
    expect(authorInput()).toHaveValue("diana (1)");
  });

  it("a search never overwrites the kept default view (#307 rule-out)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice")];
    mockPage();
    renderPage();

    await screen.findByText("Alice asks");
    // The default view is kept; the search below must not replace it —
    // a kept empty requested list would read exactly like this bug.
    fireEvent.change(authorInput(), { target: { value: "zed" } });
    fireEvent.keyDown(authorInput(), { key: "Enter" });
    await screen.findByTestId("requested-author-search-empty");
    expect((getKeptLists("r1")?.requested ?? []).map((c) => c.title)).toContain("Alice asks");
  });

  it("an unknown login names itself with a way back, and Show all clears it", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "Alice asks", "alice")];
    mockPage();
    renderPage();

    await screen.findByText("Alice asks");
    fireEvent.change(authorInput(), { target: { value: "zed" } });
    fireEvent.keyDown(authorInput(), { key: "Enter" });

    const empty = await screen.findByTestId("requested-author-search-empty");
    expect(empty).toHaveTextContent("No PRs by zed.");
    fireEvent.click(empty.querySelector("button") as HTMLButtonElement);
    await screen.findByText("Alice asks");
    expect(authorInput()).toHaveValue("All");
    expect(requestedAuthors().at(-1)).toBeUndefined();
  });
});
