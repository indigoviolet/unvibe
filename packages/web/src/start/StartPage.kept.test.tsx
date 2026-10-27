/**
 * Start page kept lists (issue #90): the last successful PR/branch lists
 * render at once from storage while a background refresh replaces them.
 * The open path still fetches fresh via `createReview`, so a kept row for
 * a since-closed PR opens fine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Repo, RepoChange, RepoChangesResponse } from "@unvibe/shared";
import { api } from "../api/client.js";
import { StartPage } from "./StartPage.js";
import { __resetKeptForTests, setKeptLists } from "./keptChanges.js";

// #225: shared Select is Base UI — pick by clicking the popup option with a
// full pointer sequence (a bare click does not commit in jsdom).
async function pickOption(trigger: HTMLElement, label: string): Promise<void> {
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: label });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}


const REPO_KEY = "unvibe.start.repoId";

const REPO1: Repo = { id: "r1", owner: "acme", name: "app", localPath: "/tmp/app", lastOpened: 0 };
const REPO2: Repo = { id: "r2", owner: "acme", name: "other", localPath: "/tmp/other", lastOpened: 0 };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pr(n: number, title: string, branch: string): RepoChange {
  return { kind: "pr", title, prNumber: n, branch, author: "you" };
}

function branch(name: string): RepoChange {
  return { kind: "branch", title: name, branch: name };
}

function baseMocks(): void {
  vi.spyOn(api, "repos").mockResolvedValue({ repos: [REPO1, REPO2] });
  vi.spyOn(api, "reviews").mockResolvedValue({ reviews: [] });
  vi.spyOn(api, "readiness").mockResolvedValue({ checks: [], generatedAt: Date.now(), cached: false });
  vi.spyOn(api, "viewer").mockResolvedValue({ login: "you" });
  vi.spyOn(api, "createReview").mockResolvedValue({ review: { id: "rv1" } } as never);
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

describe("StartPage kept lists (#90)", () => {
  it("shows kept rows before the fetch lands, then replaces them", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    setKeptLists("r1", {
      authoring: [pr(99, "Kept PR", "kept-branch")],
      requested: [],
      branches: [branch("kept-branch")],
      fetchNote: null,
    });
    baseMocks();
    const gates = {
      authoring: deferred<RepoChangesResponse>(),
      requested: deferred<RepoChangesResponse>(),
      recent: deferred<RepoChangesResponse>(),
    };
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string, filter?: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      if (filter === "authoring") return gates.authoring.promise;
      if (filter === "review-requested") return gates.requested.promise;
      return gates.recent.promise;
    }) as typeof api.repoChanges);

    renderPage();

    // Kept rows render at once: no loading state, refresh icon spinning.
    expect(await screen.findByText("Kept PR")).toBeInTheDocument();
    expect(screen.queryByTestId("repo-lists-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("lists-refresh")).toHaveAttribute("title", expect.stringMatching(/refreshing/));
    expect(screen.getByTestId("lists-refresh").querySelector(".spin")).not.toBeNull();

    gates.authoring.resolve({ changes: [pr(100, "Fresh PR", "fresh-branch")], hasMore: false });
    gates.requested.resolve({ changes: [], hasMore: false });
    gates.recent.resolve({ changes: [branch("fresh-branch")], hasMore: false });

    // Fresh data replaces the kept rows; the refresh tooltip settles to the age.
    expect(await screen.findByText("Fresh PR")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Kept PR")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("lists-refresh")).toHaveAttribute("title", "Updated just now"));
    expect(screen.getByTestId("lists-refresh").querySelector(".spin")).toBeNull();
  });

  it("keeps the old lists on a failed background refresh and shows the error note", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    setKeptLists("r1", {
      authoring: [pr(99, "Kept PR", "kept-branch")],
      requested: [],
      branches: [branch("kept-branch")],
      fetchNote: null,
    });
    baseMocks();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      throw new Error(`GET /api/repos/${id}/changes: 500 {"error":"mock gh is down"}`);
    }) as typeof api.repoChanges);

    renderPage();

    expect(await screen.findByText("Kept PR")).toBeInTheDocument();
    // The existing whole-load error shows instead of emptying the list.
    expect(await screen.findByTestId("lists-error")).toHaveTextContent(/mock gh is down/);
    expect(screen.getByText("Kept PR")).toBeInTheDocument();
  });

  it("keeps kept rows for the good filters when one filter fails", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    setKeptLists("r1", {
      authoring: [pr(99, "Kept PR", "kept-branch")],
      requested: [pr(98, "Kept review ask", "ask-branch")],
      branches: [branch("kept-branch")],
      fetchNote: null,
    });
    baseMocks();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string, filter?: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      if (filter === "authoring") throw new Error("GET x: 500 {\"error\":\"mock gh is down\"}");
      if (filter === "review-requested") return { changes: [pr(97, "Fresh ask", "ask-new")], hasMore: false };
      return { changes: [branch("kept-branch")], hasMore: false };
    }) as typeof api.repoChanges);

    renderPage();

    // Failed filter: its error shows with the kept rows still underneath.
    expect(await screen.findByTestId("changes-error-authoring")).toHaveTextContent(/mock gh is down/);
    expect(screen.getByText("Kept PR")).toBeInTheDocument();
    expect(await screen.findByText("Fresh ask")).toBeInTheDocument();
  });

  it("first load without kept rows behaves as before", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    baseMocks();
    const gate = deferred<RepoChangesResponse>();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      return gate.promise;
    }) as typeof api.repoChanges);

    renderPage();

    expect(await screen.findByTestId("repo-lists-loading")).toHaveTextContent("Loading acme/app…");
    expect(screen.queryByTestId("lists-refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Your PRs")).not.toBeInTheDocument();

    gate.resolve({ changes: [], hasMore: false });
    expect(await screen.findByText("Your PRs")).toBeInTheDocument();
  });

  it("ignores a slow previous repo's response after a quick switch", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    baseMocks();
    const slow = deferred<RepoChangesResponse>();
    const fastAuthoring = deferred<RepoChangesResponse>();
    const fastOther = deferred<RepoChangesResponse>();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string, filter?: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      if (id === "r1") return slow.promise;
      if (filter === "authoring") return fastAuthoring.promise;
      return fastOther.promise;
    }) as typeof api.repoChanges);

    renderPage();
    expect(await screen.findByTestId("repo-lists-loading")).toBeInTheDocument();

    // Switch before the first repo answers.
    await pickOption(screen.getByLabelText("Repo"), "acme/other");
    fastAuthoring.resolve({ changes: [pr(2, "R2 PR", "r2-branch")], hasMore: false });
    fastOther.resolve({ changes: [], hasMore: false });
    expect(await screen.findByText("R2 PR")).toBeInTheDocument();

    // The stale response must not overwrite the current repo's lists.
    slow.resolve({ changes: [pr(1, "R1 PR", "r1-branch")], hasMore: false });
    await waitFor(() => expect(screen.getByText("R2 PR")).toBeInTheDocument());
    expect(screen.queryByText("R1 PR")).not.toBeInTheDocument();
  });

  it("opens a kept row through the fresh open path (closed PR still opens)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    setKeptLists("r1", {
      authoring: [pr(99, "Kept PR", "kept-branch")],
      requested: [],
      branches: [],
      fetchNote: null,
    });
    baseMocks();
    const gate = deferred<RepoChangesResponse>();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      return gate.promise;
    }) as typeof api.repoChanges);
    const createReview = vi.spyOn(api, "createReview");

    renderPage();
    const row = await screen.findByText("Kept PR");
    // The kept row's title button opens with its PR number; the service
    // fetches fresh on open, so a since-closed PR still goes through this
    // path.
    const btn = row.closest(".ci")?.querySelector("button.cj-open");
    expect(btn).not.toBeNull();
    fireEvent.click(btn as HTMLButtonElement);
    await waitFor(() =>
      expect(createReview).toHaveBeenCalledWith({
        repoId: "r1",
        pr: 99,
        branch: "kept-branch",
        title: "Kept PR",
        author: "you",
      }),
    );
    gate.resolve({ changes: [], hasMore: false });
  });

  it("still loads when storage is unavailable", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    baseMocks();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string, filter?: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      if (filter === "recent") return { changes: [branch("feature-x")], hasMore: false };
      return { changes: [], hasMore: false };
    }) as typeof api.repoChanges);

    renderPage();
    // First load proceeds as today even with storage throwing.
    expect(await screen.findByText("Your PRs")).toBeInTheDocument();
    expect(screen.getAllByText("feature-x").length).toBeGreaterThan(0);
  });

  it("does not reorder kept rows before fresh data arrives", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    setKeptLists("r1", {
      authoring: [pr(3, "Third", "b3"), pr(1, "First", "b1"), pr(2, "Second", "b2")],
      requested: [],
      branches: [],
      fetchNote: null,
    });
    baseMocks();
    const gate = deferred<RepoChangesResponse>();
    vi.spyOn(api, "repoChanges").mockImplementation((async (id: string) => {
      if (id === "demo") return { changes: [], hasMore: false };
      return gate.promise;
    }) as typeof api.repoChanges);

    renderPage();
    await screen.findByText("First");
    // Order is the kept order until the fetch lands: rows are keyed stably
    // (PR number) and never reordered by the refresh machinery itself.
    const titles = screen.getAllByText(/^(Third|First|Second)$/).map((el) => el.textContent);
    expect(titles).toEqual(["Third", "First", "Second"]);
    gate.resolve({ changes: [], hasMore: false });
  });
});
