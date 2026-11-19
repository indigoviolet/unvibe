/**
 * Toolbar Explain menu tests (issues #421, #427): the icon-only bar
 * button with the new-commits dot, the shared `.fmenu` portal timeline
 * menu (guide entry, Commits group with guide/new/latest hints, head
 * disabled), picking running Explain at once, and the empty result
 * toasting the existing message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../api/client.js";
import { Toast } from "../floating/Toast.js";
import { resetMockState } from "../mock/index.js";
import { useReview } from "../state/store.js";
import { ExplainMenu } from "./ExplainMenu.js";

const REVIEW_ID = "explain-menu";
const OLD = "a".repeat(40);
const MID = "c".repeat(40);
const HEAD = "b".repeat(40);

async function seed(opts: {
  commits: { sha: string; subject: string }[];
  prNumber?: number;
  guideSha?: string;
}): Promise<void> {
  const snap = await api.review("demo");
  act(() =>
    useReview.getState().setSnapshot({
      ...snap,
      review: {
        ...snap.review,
        id: REVIEW_ID,
        repoId: "r",
        branch: "feature",
        currentVersion: 1,
        versions: [],
        ...(opts.prNumber !== undefined ? { prNumber: opts.prNumber } : {}),
      },
      version: { ...snap.version, n: 1, headSha: HEAD },
      guideHead: { version: 1, sha: opts.guideSha ?? HEAD },
      commits: opts.commits.map((c) => ({ sha: c.sha, subject: c.subject, body: "", files: [], hunks: [] })),
      ingest: { status: "ready" },
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExplainMenu (#421, #427)", () => {
  const GONE = "d".repeat(40);
  const prior = (sha: string) =>
    vi
      .spyOn(api, "priorGithubReview")
      .mockResolvedValue({ review: { sha, submittedAt: "2026-11-03T00:00:00Z" } } as never);

  it("marks the listed commit as your last review instead of a second row (owner)", async () => {
    prior(OLD);
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: MID, subject: "middle" }, { sha: HEAD, subject: "head work" }], prNumber: 7, guideSha: HEAD });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    const menu = screen.getByTestId("explain-menu");
    await waitFor(() => expect(menu.querySelector(`[data-explain-commit="${OLD}"]`)).toHaveTextContent("your last review"));
    expect(menu.querySelector("[data-explain-prior]")).toBeNull();
    expect(menu.querySelector(`[data-explain-commit="${MID}"]`)).not.toHaveTextContent("your last review");
  });

  it("keeps a separate last-review row when that commit isn't in the list", async () => {
    prior(GONE);
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], prNumber: 7, guideSha: HEAD });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    const menu = screen.getByTestId("explain-menu");
    await waitFor(() => expect(menu.querySelector(`[data-explain-prior="${GONE}"]`)).toHaveTextContent("Your last GitHub review"));
    expect(menu).not.toHaveTextContent("your last review");
  });

  it("is an icon-only bar button opening the shared menu with every commit oldest first and the head disabled", async () => {
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], guideSha: HEAD });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    const btn = screen.getByTestId("explain-menu-button");
    expect(btn).toHaveClass("ib");
    expect(btn).toHaveAttribute("aria-label", "Explain changes since…");
    expect(btn).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(btn);
    const menu = screen.getByTestId("explain-menu");
    expect(menu).toHaveClass("fmenu");
    expect(menu).toHaveAttribute("role", "menu");
    const rows = menu.querySelectorAll("[data-explain-commit]");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(`${OLD.slice(0, 8)} older work`);
    const headRow = screen.getByTestId("explain-menu").querySelector(`[data-explain-commit="${HEAD}"]`);
    expect(headRow).toBeDisabled();
    expect(headRow).toHaveTextContent("latest");
  });

  it("picking a commit runs Explain at once; the button is busy while it runs; the empty result toasts", async () => {
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], guideSha: HEAD });
    const explain = vi.spyOn(api, "explain");
    render(
      <>
        <ExplainMenu reviewId={REVIEW_ID} />
        <Toast />
      </>,
    );
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    fireEvent.click(screen.getByTestId("explain-menu").querySelector(`[data-explain-commit="${OLD}"]`)!);
    // The menu closes and the run starts with the picked sha.
    await waitFor(() => expect(screen.queryByTestId("explain-menu")).toBeNull());
    expect(explain).toHaveBeenCalledWith(REVIEW_ID, { sha: OLD });
    // Busy while the pass runs: dots in place of the icon.
    expect(screen.getByTestId("explain-menu-button").querySelector(".dots")).not.toBeNull();
    // The mock settles with the section untouched: the existing empty
    // message toasts (visible from either pane).
    await screen.findByText(`No changes to explain since ${OLD.slice(0, 8)}`, undefined, { timeout: 15_000 });
  });

  it("hides when nothing is pickable (only the head commit)", async () => {
    await seed({ commits: [{ sha: HEAD, subject: "head work" }], guideSha: HEAD });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    expect(screen.queryByTestId("explain-menu-button")).toBeNull();
  });

  it("dots the icon and counts new commits since the guide; the menu leads with the guide entry and hints", async () => {
    await seed({
      commits: [{ sha: OLD, subject: "older work" }, { sha: MID, subject: "middle" }, { sha: HEAD, subject: "head work" }],
      guideSha: OLD,
    });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    const btn = screen.getByTestId("explain-menu-button");
    expect(btn).toHaveAttribute("aria-label", "2 new commits since the guide was written");
    expect(btn.querySelector("[data-new-commits]")).not.toBeNull();
    fireEvent.click(btn);
    const menu = screen.getByTestId("explain-menu");
    // First item runs Explain from the guide's commit.
    const guide = menu.querySelector("[data-explain-guide]");
    expect(guide).toHaveTextContent("Explain changes since the guide");
    // Hints: guide on the guide's row, new after it, latest disabled.
    expect(menu.querySelector(`[data-explain-commit="${OLD}"]`)).toHaveTextContent("guide");
    expect(menu.querySelector(`[data-explain-commit="${MID}"]`)).toHaveTextContent("new");
    expect(menu.querySelector(`[data-explain-commit="${HEAD}"]`)).toHaveTextContent("latest");
    expect(menu.querySelector(`[data-explain-commit="${HEAD}"]`)).toBeDisabled();
    expect(menu.querySelector(`[data-explain-commit="${OLD}"]`)).not.toBeDisabled();
  });

  it("runs Explain from the guide's commit via the first item", async () => {
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], guideSha: OLD });
    const explain = vi.spyOn(api, "explain");
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    fireEvent.click(screen.getByTestId("explain-menu").querySelector("[data-explain-guide]")!);
    await waitFor(() => expect(screen.queryByTestId("explain-menu")).toBeNull());
    expect(explain).toHaveBeenCalledWith(REVIEW_ID, { sha: OLD });
  });

  it("marks guide on the head with no dot once the guide moves there (Re-do)", async () => {    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], guideSha: OLD });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    expect(screen.getByTestId("explain-menu-button")).toHaveAttribute(
      "aria-label",
      "1 new commit since the guide was written",
    );
    // A Re-do stamps guideHead at the head: the dot clears.
    const snap = useReview.getState().snapshot;
    act(() =>
      useReview.getState().setSnapshot({
        ...snap!,
        guideHead: { version: 1, sha: HEAD },
      }),
    );
    const btn = screen.getByTestId("explain-menu-button");
    expect(btn).toHaveAttribute("aria-label", "Explain changes since…");
    expect(btn.querySelector("[data-new-commits]")).toBeNull();
    fireEvent.click(btn);
    const menu = screen.getByTestId("explain-menu");
    expect(menu.querySelector("[data-explain-guide]")).toBeNull();
    expect(menu.querySelector(`[data-explain-commit="${HEAD}"]`)).toHaveTextContent("guide");
    expect(menu.querySelector(`[data-explain-commit="${HEAD}"]`)).toHaveTextContent("latest");
  });
});
