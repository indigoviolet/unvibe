/**
 * Start page review requests (#95): "Waiting on your review" splits into
 * asked-of-you and asked-of-your-team (a PR asking both shows once, as
 * direct), newest first with a relative time and team names on each row,
 * plus a recency filter (1d, 3d, 1w, 2w, All, default All) that persists
 * like the other start-page preferences, and an empty state per section
 * and per filtered-out window.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Repo, RepoChange, ReviewSummary } from "@unvibe/shared";
import { api } from "../api/client.js";
import { RECENCY_KEY, StartPage, inRecencyWindow, reviewScopeOf } from "./StartPage.js";
import { __resetKeptForTests } from "./keptChanges.js";

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
const REPO: Repo = { id: "r1", owner: "acme", name: "app", localPath: "/tmp/app", lastOpened: 0 };
const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function pr(n: number, title: string, updatedAt: number, extra?: Partial<RepoChange>): RepoChange {
  return { kind: "pr", title, prNumber: n, branch: `b${n}`, author: "teammate", updatedAt, ...extra };
}

const DIRECT_NEW = pr(12, "Asked of you and your team", NOW - HOUR, {
  reviewScope: "direct",
  requestedTeams: ["core"],
});
const DIRECT_OLD = pr(11, "Asked of you", NOW - 2 * HOUR, { reviewScope: "direct" });
const TEAM_MID = pr(13, "Asked of your team", NOW - 2 * DAY, {
  reviewScope: "team",
  requestedTeams: ["core"],
});
const TEAM_OLD = pr(14, "Old team ask", NOW - 20 * DAY, {
  reviewScope: "team",
  requestedTeams: ["core"],
});
const UNSCOPED = pr(15, "Stored before scopes", NOW - 3 * HOUR);
const SIZED = pr(16, "Sized PR", NOW - 4 * HOUR, {
  reviewScope: "direct",
  additions: 1200,
  deletions: 34,
  changedFiles: 6,
});
const UNSIZED = pr(17, "Unsized PR", NOW - 5 * HOUR, { reviewScope: "direct" });

function mockLists(requested: RepoChange[], authoring: RepoChange[] = [], branches: RepoChange[] = []): void {
  vi.spyOn(api, "repos").mockResolvedValue({ repos: [REPO] });
  vi.spyOn(api, "reviews").mockResolvedValue({ reviews: [] });
  vi.spyOn(api, "readiness").mockResolvedValue({ checks: [], generatedAt: Date.now(), cached: false });
  vi.spyOn(api, "viewer").mockResolvedValue({ login: "you" });
  vi.spyOn(api, "createReview").mockResolvedValue({ review: { id: "rv1" } } as never);
  vi.spyOn(api, "repoChanges").mockImplementation((async (id: string, filter?: string) => {
    if (id === "demo") return { changes: [] };
    if (filter === "authoring") return { changes: authoring };
    if (filter === "review-requested") return { changes: requested };
    if (filter === "recent") return { changes: branches };
    return { changes: [] };
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

describe("reviewScopeOf / inRecencyWindow (#95)", () => {
  it("reads team only when marked; everything else is direct", () => {
    expect(reviewScopeOf({ kind: "pr", title: "t", reviewScope: "team" })).toBe("team");
    expect(reviewScopeOf({ kind: "pr", title: "t", reviewScope: "direct" })).toBe("direct");
    expect(reviewScopeOf({ kind: "pr", title: "t" })).toBe("direct");
    expect(reviewScopeOf({ kind: "branch", title: "b", branch: "b" })).toBe("direct");
  });

  it("keeps every window boundary inclusive and unknown ages visible", () => {
    const now = NOW;
    const row = pr(1, "t", now - DAY);
    expect(inRecencyWindow(row, DAY, now)).toBe(true);
    expect(inRecencyWindow(row, DAY - 1, now)).toBe(false);
    expect(inRecencyWindow(row, null, now)).toBe(true);
    // No known update: visible under every window (unknown, not old).
    const ageless: RepoChange = { kind: "pr", title: "t", prNumber: 2 };
    expect(inRecencyWindow(ageless, DAY, now)).toBe(true);
  });
});

describe("StartPage requested split and filter (#95)", () => {
  it("splits direct and team, newest first, with time and no team names", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    // The service returns both groups newest-first; the page keeps that order.
    mockLists([DIRECT_NEW, DIRECT_OLD, TEAM_MID, TEAM_OLD]);
    renderPage();

    expect(await screen.findByText("Requested of you")).toBeInTheDocument();
    expect(screen.getByText("Requested of your team")).toBeInTheDocument();
    // A PR asking both shows once, as direct.
    expect(screen.getAllByText("Asked of you and your team")).toHaveLength(1);
    // Newest first within the direct group.
    const titles = screen.getAllByText(/Asked of you/).map((el) => el.textContent);
    expect(titles[0]).toBe("Asked of you and your team");
    // Relative time on the rows; the team name is not shown (#224).
    expect(screen.getByText(/1h ago/)).toBeInTheDocument();
    expect(screen.queryByText(/via core/)).not.toBeInTheDocument();
  });

  it("shows rows stored before scopes under direct", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([UNSCOPED]);
    renderPage();
    expect(await screen.findByText("Stored before scopes")).toBeInTheDocument();
    expect(screen.queryByTestId("requested-team-empty")).toHaveTextContent("No PRs requested of your team.");
  });

  it("filters both groups by window and remembers the choice", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([DIRECT_NEW, DIRECT_OLD, TEAM_MID, TEAM_OLD]);
    renderPage();
    await screen.findByText("Old team ask");

    expect(screen.getByLabelText("Updated within")).toHaveTextContent("All");
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(localStorage.getItem(RECENCY_KEY)).toBe("1d");
    // Both groups hide rows older than a day; the team group is filtered out.
    expect(screen.queryByText("Asked of your team")).not.toBeInTheDocument();
    expect(screen.getByTestId("requested-team-empty")).toHaveTextContent("No PRs updated in the last day.");
    expect(screen.getByText("Asked of you and your team")).toBeInTheDocument();

    await pickOption(screen.getByLabelText("Updated within"), "Last 3 days");
    expect(screen.getByText("Asked of your team")).toBeInTheDocument();
    expect(screen.queryByText("Old team ask")).not.toBeInTheDocument();

    await pickOption(screen.getByLabelText("Updated within"), "All");
    expect(screen.getByText("Old team ask")).toBeInTheDocument();
  });

  it("restores the remembered window on load", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    localStorage.setItem(RECENCY_KEY, "1w");
    mockLists([DIRECT_NEW, TEAM_OLD]);
    renderPage();
    await screen.findByText("Asked of you and your team");
    expect(screen.getByLabelText("Updated within")).toHaveTextContent("Last week");
    expect(screen.queryByText("Old team ask")).not.toBeInTheDocument();
    expect(screen.getByTestId("requested-team-empty")).toHaveTextContent("No PRs updated in the last week.");
  });

  it("shows an empty state per section when nothing is requested", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([]);
    renderPage();
    expect(await screen.findByTestId("requested-direct-empty")).toHaveTextContent("No PRs requested of you.");
    expect(screen.getByTestId("requested-team-empty")).toHaveTextContent("No PRs requested of your team.");
  });

  it("renders the diff size when known and omits it when unknown (#100)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([SIZED, UNSIZED]);
    renderPage();
    expect(await screen.findByText("Sized PR")).toBeInTheDocument();
    const sizedMeta = screen.getByText("Sized PR").closest(".ci")?.querySelector(".cw");
    expect(sizedMeta?.textContent).toContain("+1,200");
    expect(sizedMeta?.textContent).toContain("−34");
    // #224: the file count is not shown.
    expect(sizedMeta?.textContent).not.toContain("files");
    expect(sizedMeta?.querySelector(".a")?.textContent).toBe("+1,200");
    expect(sizedMeta?.querySelector(".d")?.textContent).toBe("−34");
    // The unsized row carries no size text in its meta line.
    const unsizedMeta = screen.getByText("Unsized PR").closest(".ci")?.querySelector(".cw");
    expect(unsizedMeta?.textContent).not.toContain("+");
    expect(unsizedMeta?.textContent).not.toContain("file");
  });

  it("links the PR label to GitHub without opening the review (#94)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([DIRECT_NEW]);
    renderPage();
    const createReview = vi.mocked(api.createReview);
    const link = await screen.findByRole("link", { name: "Open PR #12 on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/pull/12");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    // The link sits in the row but outside the row's own button, so both
    // stay keyboard-reachable and the link never triggers the row.
    const row = link.closest(".ci");
    expect(row?.querySelector("button.cj-open")).not.toBeNull();
    expect(link.closest("button")).toBeNull();
    fireEvent.click(link);
    expect(createReview).not.toHaveBeenCalled();
    // The title button still opens the review.
    fireEvent.click(row?.querySelector("button.cj-open") as HTMLButtonElement);
    await waitFor(() => expect(createReview).toHaveBeenCalled());
  });

  it("prefers the URL gh returned when the row has one (#94)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([pr(21, "Mirror PR", NOW - HOUR, { reviewScope: "direct", url: "https://example.com/mirror/21" })]);
    renderPage();
    const link = await screen.findByRole("link", { name: "Open PR #21 on GitHub" });
    expect(link).toHaveAttribute("href", "https://example.com/mirror/21");
  });

  it("links session PR labels and skips branch-only rows (#94)", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([]);
    const base: ReviewSummary = {
      id: "s",
      repoId: "r1",
      repoOwner: "acme",
      repoName: "app",
      title: "t",
      branch: "b",
      createdAt: NOW - DAY,
      lastOpened: NOW - HOUR,
      versionCount: 1,
      currentVersion: 1,
      stale: false,
      totalHunks: 8,
      reviewedHunks: 0,
      pendingComments: 0,
      guideStatus: "ready",
      ingestStatus: "ready",
    };
    vi.mocked(api.reviews).mockResolvedValue({
      reviews: [
        { ...base, id: "s-pr", title: "PR review", branch: "b12", prNumber: 12 },
        { ...base, id: "s-branch", title: "Branch review", branch: "feature-x" },
      ],
    });
    renderPage();
    const link = await screen.findByRole("link", { name: "Open PR #12 on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/pull/12");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.closest("button")).toBeNull();
    const branchRow = screen.getByText("Branch review").closest(".ci");
    expect(branchRow?.querySelector("a")).toBeNull();
  });
});

describe("StartPage authoring filter (#131)", () => {
  const AUTHORED_NEW = pr(31, "My fresh PR", NOW - HOUR, { author: "you" });
  const AUTHORED_OLD = pr(32, "My old PR", NOW - 2 * DAY, { author: "you" });

  it("sorts Your PRs newest first with relative times", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    // Deliberately oldest-first: the page still renders newest first.
    mockLists([DIRECT_NEW], [AUTHORED_OLD, AUTHORED_NEW]);
    renderPage();
    await screen.findByText("My old PR");
    const rows = screen.getAllByText(/My (fresh|old) PR/).map((el) => el.textContent);
    expect(rows[0]).toBe("My fresh PR");
    expect(rows[1]).toBe("My old PR");
    const freshMeta = screen.getByText("My fresh PR").closest(".ci")?.querySelector(".cw");
    expect(freshMeta?.textContent).toContain("1h ago");
  });

  it("one control filters Your PRs and both review groups, with a way back", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([DIRECT_NEW, TEAM_MID], [AUTHORED_NEW, AUTHORED_OLD]);
    renderPage();
    await screen.findByText("My old PR");

    // One control for the whole page.
    expect(screen.getAllByLabelText("Updated within")).toHaveLength(1);
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    // The old authored PR and the 2-day-old team ask hide; recent rows stay.
    expect(screen.queryByText("My old PR")).not.toBeInTheDocument();
    expect(screen.getByText("My fresh PR")).toBeInTheDocument();
    expect(screen.queryByText("Asked of your team")).not.toBeInTheDocument();
    expect(screen.getByTestId("requested-team-empty")).toHaveTextContent("No PRs updated in the last day.");
    // The filtered-out group offers a way back to All.
    const showAll = screen.getByTestId("requested-team-empty").querySelector("button");
    expect(showAll).toHaveTextContent("Show all");
    fireEvent.click(showAll as HTMLButtonElement);
    expect(screen.getByText("My old PR")).toBeInTheDocument();
    expect(screen.getByText("Asked of your team")).toBeInTheDocument();
    expect(screen.getByLabelText("Updated within")).toHaveTextContent("All");
  });

  it("a filtered-out Your PRs list names its window and offers All", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([], [AUTHORED_OLD]);
    renderPage();
    await screen.findByText("My old PR");
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(screen.queryByText("My old PR")).not.toBeInTheDocument();
    const empty = screen.getByTestId("authoring-empty");
    expect(empty).toHaveTextContent("No PRs updated in the last day.");
    fireEvent.click(empty.querySelector("button") as HTMLButtonElement);
    expect(screen.getByText("My old PR")).toBeInTheDocument();
  });

  it("filtered-empty review groups offer All too", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([DIRECT_NEW, TEAM_MID], []);
    renderPage();
    await screen.findByText("Asked of your team");
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(screen.queryByText("Asked of your team")).not.toBeInTheDocument();
    expect(screen.getByTestId("requested-team-empty")).toHaveTextContent("No PRs updated in the last day.");
    expect(screen.getByTestId("requested-team-empty").querySelector("button")).toHaveTextContent("Show all");
  });
});

describe("StartPage branches filter (#131)", () => {
  function branch(name: string, updatedAt: number): RepoChange {
    return { kind: "branch", title: name, branch: name, updatedAt };
  }

  const FRESH = branch("fresh-work", NOW - HOUR);
  const STALE = branch("old-experiment", NOW - 2 * DAY);

  it("sorts branches newest first with ages on the rows", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    // Deliberately oldest-first: the page still renders newest first.
    mockLists([], [], [STALE, FRESH]);
    renderPage();
    await screen.findByText("old-experiment");
    const rows = screen.getAllByText(/^(fresh-work|old-experiment)$/).map((el) => el.textContent);
    expect(rows[0]).toBe("fresh-work");
    expect(rows[1]).toBe("old-experiment");
    const freshMeta = screen.getByText("fresh-work").closest(".ci")?.querySelector(".cw");
    expect(freshMeta?.textContent).toContain("1h ago");
  });

  it("one control filters branches by last commit with a way back", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([], [], [STALE, FRESH]);
    renderPage();
    await screen.findByText("old-experiment");

    // Still one control for the whole page.
    expect(screen.getAllByLabelText("Updated within")).toHaveLength(1);
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(screen.queryByText("old-experiment")).not.toBeInTheDocument();
    expect(screen.getByText("fresh-work")).toBeInTheDocument();
    // Reviews above stay unfiltered: the control sits below them.
    const control = screen.getByLabelText("Updated within");
    const reviews = screen.getByRole("heading", { name: "Reviews" });
    expect(reviews.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a filtered-out branch list names its window and offers All", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([], [], [STALE]);
    renderPage();
    await screen.findByText("old-experiment");
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(screen.queryByText("old-experiment")).not.toBeInTheDocument();
    const empty = screen.getByTestId("branches-empty");
    expect(empty).toHaveTextContent("No branches updated in the last day.");
    fireEvent.click(empty.querySelector("button") as HTMLButtonElement);
    expect(screen.getByText("old-experiment")).toBeInTheDocument();
    expect(screen.getByLabelText("Updated within")).toHaveTextContent("All");
  });

  it("Reviews ignores the window, ordered by recent activity", async () => {
    localStorage.setItem(REPO_KEY, "r1");
    mockLists([], [], []);
    const base: ReviewSummary = {
      id: "s",
      repoId: "r1",
      repoOwner: "acme",
      repoName: "app",
      title: "t",
      branch: "b",
      createdAt: NOW - 20 * DAY,
      lastOpened: NOW - 20 * DAY,
      versionCount: 1,
      currentVersion: 1,
      stale: false,
      totalHunks: 8,
      reviewedHunks: 0,
      pendingComments: 0,
      guideStatus: "ready",
      ingestStatus: "ready",
    };
    vi.mocked(api.reviews).mockResolvedValue({
      reviews: [{ ...base, id: "s-old", title: "Old review" }],
    });
    renderPage();
    await screen.findByText("Old review");
    // A three-week-old last activity still lists under the 1-day window.
    await pickOption(screen.getByLabelText("Updated within"), "Last day");
    expect(screen.getByText("Old review")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-empty")).not.toBeInTheDocument();
  });
});
