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
import { decodeChangesCursor, encodeChangesCursor } from "@unvibe/shared";
import { api } from "../api/client.js";
import { StartPage } from "./StartPage.js";
import { __resetKeptForTests, getKeptLists } from "./keptChanges.js";

const REPO_KEY = "unvibe.start.repoId";
const REPO: Repo = { id: "r1", owner: "acme", name: "app", localPath: "/tmp/app", lastOpened: 0 };

function pr(n: number, title: string, author: string): RepoChange {
  return { kind: "pr", title, prNumber: n, branch: `b${n}`, author, updatedAt: Date.now() };
}

type ChangesOpts = { limit?: number; author?: string; cursor?: string | null };
const seen: { filter?: string; opts?: ChangesOpts }[] = [];
let requestedRows: RepoChange[] = [];
let requestedHasMore = false;
/** Rows the mock serves as the next page once the client sends a cursor. */
let nextPageRows: RepoChange[] = [];
/** When true, a cursor-paged call rejects like a failed next page. */
let failNextPage = false;
/** When set, cursor-paged calls wait until the test releases them. */
let nextPageGate: { wait: Promise<void>; open: () => void } | null = null;

export function holdNextPage(): void {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  nextPageGate = { wait, open };
}

export function releaseNextPage(): void {
  nextPageGate?.open();
  nextPageGate = null;
}

function mockPage(): void {
  seen.length = 0;
  failNextPage = false;
  nextPageGate = null;
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
    if (id === "demo") return { changes: [], hasMore: false, cursor: null };
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
      // #310: cursor paging like the service — a cursor fetches the next
      // page only (the mock's second page), never a re-fetch. A flagged
      // page rejects like a failed `gh` call (the service answers 502);
      // a gated page waits.
      if (opts?.cursor !== undefined && opts.cursor !== null) {
        if (failNextPage) {
          throw new Error(
            `GET /api/repos/${id}/changes: 502 {"error":"couldn't load the next page from GitHub"}`,
          );
        }
        if (nextPageGate) await nextPageGate.wait;
        return { changes: nextPageRows, hasMore: false, cursor: null };
      }
      return {
        changes: rows,
        hasMore: requestedHasMore,
        cursor: requestedHasMore ? encodeChangesCursor({ direct: "d1", team: "t1" }) : null,
      };
    }
    return { changes: [], hasMore: false, cursor: null };
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

describe("Load more PRs, one page per press (#310)", () => {
  it("appends the next page with the cursor and grows the authors", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "First ask", "alice"), pr(2, "Second ask", "bob")];
    requestedHasMore = true;
    nextPageRows = [pr(3, "Third ask", "carol")];
    mockPage();
    renderPage();

    await screen.findByText("First ask");
    const more = await screen.findByTestId("lists-load-more");
    expect(more).toHaveTextContent("Load more PRs");

    fireEvent.click(more);
    // Loading state while the page is in flight, button locked.
    expect(more).toHaveTextContent("Loading…");
    expect(more).toBeDisabled();
    await screen.findByText("Third ask");
    // Earlier rows stay; the list grew instead of re-fetching.
    expect(screen.getByText("First ask")).toBeInTheDocument();
    expect(screen.getByText("Second ask")).toBeInTheDocument();
    // The author list grew with the new rows.
    expect(authorInput()).toHaveValue("All");
    await openCombo();
    expect(await screen.findByRole("option", { name: "carol (1)" })).toBeInTheDocument();
    fireEvent.keyDown(authorInput(), { key: "Escape" });
    expect(authorInput()).toHaveValue("All");
    // Exactly one follow-up requested call, carrying the cursor — the
    // first page was never re-fetched.
    const requestedCalls = seen.filter((s) => s.filter === "review-requested");
    expect(requestedCalls).toHaveLength(2);
    expect(requestedCalls[0].opts?.cursor).toBeUndefined();
    expect(decodeChangesCursor(requestedCalls[1].opts?.cursor)).toEqual({
      authoring: null,
      direct: "d1",
      team: "t1",
    });
    // The next page exhausted the mock: the button is gone.
    expect(screen.queryByTestId("lists-load-more")).not.toBeInTheDocument();
  });

  it("a failed page keeps the rows and offers Retry on the same cursor", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "First ask", "alice")];
    requestedHasMore = true;
    nextPageRows = [pr(2, "Second ask", "bob")];
    mockPage();
    failNextPage = true;
    renderPage();

    await screen.findByText("First ask");
    fireEvent.click(await screen.findByTestId("lists-load-more"));
    const note = await screen.findByTestId("lists-more-error");
    expect(note).toHaveTextContent("couldn't load the next page from GitHub");
    // Nothing was cleared: the first page still shows, with a Retry.
    expect(screen.getByText("First ask")).toBeInTheDocument();
    expect(screen.queryByText("Second ask")).not.toBeInTheDocument();
    const retry = await screen.findByTestId("lists-load-more");
    expect(retry).toHaveTextContent("Retry");
    expect(retry).not.toBeDisabled();
    // Retry re-fires the same cursor and this time lands the page.
    failNextPage = false;
    fireEvent.click(retry);
    await screen.findByText("Second ask");
    expect(screen.getByText("First ask")).toBeInTheDocument();
    const cursors = seen.filter((s) => s.filter === "review-requested").map((s) => s.opts?.cursor);
    expect(cursors[0]).toBeUndefined();
    expect(cursors[1]).toEqual(cursors[2]);
    expect(decodeChangesCursor(cursors[1])).toEqual({
      authoring: null,
      direct: "d1",
      team: "t1",
    });
    expect(screen.queryByTestId("lists-load-more")).not.toBeInTheDocument();
  });

  it("ignores a second press while a page is in flight", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    requestedRows = [pr(1, "First ask", "alice")];
    requestedHasMore = true;
    nextPageRows = [pr(2, "Second ask", "bob")];
    mockPage();
    holdNextPage();
    renderPage();

    await screen.findByText("First ask");
    const more = await screen.findByTestId("lists-load-more");
    fireEvent.click(more);
    // Second press lands while disabled: no second fetch starts.
    expect(more).toBeDisabled();
    fireEvent.click(more);
    await screen.findByText("First ask");
    releaseNextPage();
    await screen.findByText("Second ask");
    const requestedCalls = seen.filter((s) => s.filter === "review-requested");
    expect(requestedCalls).toHaveLength(2);
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
