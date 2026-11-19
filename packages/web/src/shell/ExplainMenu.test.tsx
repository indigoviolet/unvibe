/**
 * Toolbar Explain menu tests (issue #421): the icon-only bar button,
 * the shared `.fmenu` portal menu listing every commit oldest first
 * with the head disabled, picking running Explain at once, and the
 * empty result toasting the existing message.
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
const HEAD = "b".repeat(40);

async function seed(opts: { commits: { sha: string; subject: string }[]; prNumber?: number }): Promise<void> {
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

describe("ExplainMenu (#421)", () => {
  const MID = "c".repeat(40);
  const GONE = "d".repeat(40);
  const prior = (sha: string) =>
    vi
      .spyOn(api, "priorGithubReview")
      .mockResolvedValue({ review: { sha, submittedAt: "2026-11-03T00:00:00Z" } } as never);

  it("marks the listed commit as your last review instead of a second row (owner)", async () => {
    prior(OLD);
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: MID, subject: "middle" }, { sha: HEAD, subject: "head work" }], prNumber: 7 });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    const menu = screen.getByTestId("explain-menu");
    await waitFor(() => expect(menu.querySelector(`[data-explain-commit="${OLD}"]`)).toHaveTextContent("your last review"));
    expect(menu.querySelector("[data-explain-prior]")).toBeNull();
    expect(menu.querySelector(`[data-explain-commit="${MID}"]`)).not.toHaveTextContent("your last review");
  });

  it("keeps a separate last-review row when that commit isn't in the list", async () => {
    prior(GONE);
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }], prNumber: 7 });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-menu-button"));
    const menu = screen.getByTestId("explain-menu");
    await waitFor(() => expect(menu.querySelector(`[data-explain-prior="${GONE}"]`)).toHaveTextContent("Your last GitHub review"));
    expect(menu).not.toHaveTextContent("your last review");
  });

  it("is an icon-only bar button opening the shared menu with every commit oldest first and the head disabled", async () => {
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }] });
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
    await seed({ commits: [{ sha: OLD, subject: "older work" }, { sha: HEAD, subject: "head work" }] });
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
    await seed({ commits: [{ sha: HEAD, subject: "head work" }] });
    render(<ExplainMenu reviewId={REVIEW_ID} />);
    expect(screen.queryByTestId("explain-menu-button")).toBeNull();
  });
});
