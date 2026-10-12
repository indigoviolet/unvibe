/**
 * ReviewBar tests (issue #31 round 2): review identity, the GitHub
 * link-out (PR reviews only), the Debug icon button, the Guide|Source
 * selector, and Comments + primary Submit side by side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api/client.js";
import { resetMockState } from "../mock/index.js";
import { useReview } from "../state/store.js";
import { ReviewBar } from "./ReviewBar.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
});

const noop = (): void => {};

async function renderBar(reviewId: string): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/review/${reviewId}`]}>
      <ReviewBar reviewId={reviewId} guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
    </MemoryRouter>,
  );
  // The identity falls back to the review id until the summary/snapshot
  // arrive; wait for the PR identity instead.
  await screen.findByText("urllib3/urllib3#5020", {}, { timeout: 5000 });
}

/** Store a modified copy of the demo snapshot under another review id. */
async function seedReview(review: Record<string, unknown>): Promise<void> {
  const snap = await api.review("demo");
  useReview.getState().setSnapshot({
    ...snap,
    review: { ...snap.review, ...review },
  } as typeof snap);
}

describe("ReviewBar", () => {
  it("shows identity, GitHub link, Debug icon, Guide|Source and Comments + Submit", async () => {
    await renderBar("demo");
    const bar = document.getElementById("reviewbar");
    expect(bar).not.toBeNull();
    expect(bar).toHaveTextContent("Unfold obsolete folded response header values");
    const github = screen.getByRole("link", { name: "Open PR on GitHub" });
    expect(github).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5020");
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", "noreferrer");
    const debug = screen.getByRole("link", { name: "Debug" });
    expect(debug).toHaveAttribute("href", "/review/demo/debug");
    expect(debug).toHaveAttribute("title", "Debug");
    expect(screen.getByRole("button", { name: "Guide" })).toHaveAttribute("aria-pressed", "true");
    expect(document.getElementById("toggleRight")).toHaveTextContent("Source");
    expect(screen.getByRole("button", { name: /Comments/ })).toBeInTheDocument();
    // Submit is the primary (filled) action in the bar.
    const submit = document.querySelector("#submitSlot [data-submit]");
    expect(submit?.className).toContain("btn");
    expect(submit?.textContent).toMatch(/Submit/);
  });

  it("shows no GitHub link for a branch review", async () => {
    await seedReview({ id: "branch-x", repoId: "urllib3", prNumber: undefined, branch: "feature" });
    render(
      <MemoryRouter initialEntries={["/review/branch-x"]}>
        <ReviewBar reviewId="branch-x" guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
      </MemoryRouter>,
    );
    await screen.findByText("feature");
    expect(screen.queryByRole("link", { name: "Open PR on GitHub" })).toBeNull();
  });

  it("shows no GitHub link for the demo", async () => {
    await seedReview({ id: "demo-x", repoId: "demo", prNumber: 5020, branch: "demo" });
    render(
      <MemoryRouter initialEntries={["/review/demo-x"]}>
        <ReviewBar reviewId="demo-x" guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
      </MemoryRouter>,
    );
    await screen.findByText("demo/urllib3-5020#5020");
    expect(screen.queryByRole("link", { name: "Open PR on GitHub" })).toBeNull();
  });

  it("toggles call their handlers", async () => {
    const onToggleGuide = vi.fn();
    const onToggleSource = vi.fn();
    const snap = await api.review("demo");
    useReview.getState().setSnapshot(snap);
    render(
      <MemoryRouter initialEntries={["/review/demo"]}>
        <ReviewBar
          reviewId="demo"
          guideOpen={false}
          sourceOpen
          onToggleGuide={onToggleGuide}
          onToggleSource={onToggleSource}
        />
      </MemoryRouter>,
    );
    await screen.findByText("urllib3/urllib3#5020", {}, { timeout: 5000 });
    screen.getByRole("button", { name: "Guide" }).click();
    screen.getByRole("button", { name: "Source" }).click();
    expect(onToggleGuide).toHaveBeenCalledOnce();
    expect(onToggleSource).toHaveBeenCalledOnce();
  });
});
