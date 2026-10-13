/**
 * ReviewBar tests (issue #31 round 2): review identity, the GitHub
 * link-out (PR reviews only), the Debug icon button, the Guide|Source
 * selector, and Comments + primary Submit side by side. Issue #120: the
 * version selector lives here next to the identity (rendered once, also
 * with the guide pane hidden); the current version is annotated in the
 * dropdown and an older shown version flags the select.
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

async function renderBar(reviewId: string, identity: string): Promise<void> {
  // ReviewBar reads the snapshot from the store (loaded by the panes in
  // the app); seed it here the same way.
  useReview.getState().setSnapshot(await api.review(reviewId));
  render(
    <MemoryRouter initialEntries={[`/review/${reviewId}`]}>
      <ReviewBar reviewId={reviewId} guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
    </MemoryRouter>,
  );
  // The identity falls back to the review id until the summary arrives;
  // wait for the PR identity instead.
  await screen.findByText(identity, {}, { timeout: 5000 });
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
    // r-old is a PR review (urllib3/urllib3#5011); the demo hides its
    // GitHub link (see below), so the present-case uses r-old.
    await renderBar("r-old", "urllib3/urllib3#5011");
    const bar = document.getElementById("reviewbar");
    expect(bar).not.toBeNull();
    // Issue #141: the home control is the bar's first control; no
    // Settings gear on a review (Settings is reached from the start page).
    const home = screen.getByRole("link", { name: "Back to the start page" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveAttribute("title", "Back to the start page");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(bar).toHaveTextContent("Fix retry backoff on 429s");
    const github = screen.getByRole("link", { name: "Open PR on GitHub" });
    expect(github).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5011");
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", "noreferrer");
    const debug = screen.getByRole("link", { name: "Debug" });
    expect(debug).toHaveAttribute("href", "/review/r-old/debug");
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
    // The mock demo snapshot carries repoId "demo" like the real demo, so
    // the PR link-out stays hidden even though the summary names the PR.
    await renderBar("demo", "urllib3/urllib3#5020");
    expect(screen.queryByRole("link", { name: "Open PR on GitHub" })).toBeNull();
  });

  it("hides the Debug icon while the review is still opening (#92)", async () => {
    // A loading review has no finished open (version 0); the Debug page
    // refuses earlier states, so the icon waits. The rest of the bar stays
    // usable: identity from the hints, harmless pane selector, no Submit.
    const snap = await api.review("demo");
    useReview.getState().setSnapshot({
      ...snap,
      review: { ...snap.review, id: "opening-1", branch: "feature" },
      version: { ...snap.version, n: 0 },
      files: [],
      pages: [],
      ingest: { status: "loading", step: "fetching" },
    } as typeof snap);
    render(
      <MemoryRouter initialEntries={["/review/opening-1"]}>
        <ReviewBar reviewId="opening-1" guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Debug" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guide" })).toBeInTheDocument();
    expect(document.getElementById("toggleRight")).toHaveTextContent("Source");
    expect(document.querySelector("#submitSlot")).toBeNull();
    // The open finishing (loading → ready) must not break the hook order:
    // the Debug icon appears without throwing.
    const { act } = await import("@testing-library/react");
    const ready = await api.review("demo");
    await act(async () => {
      useReview.getState().setSnapshot({ ...ready, review: { ...ready.review, id: "opening-1" } });
    });
    expect(screen.getByRole("link", { name: "Debug" })).toHaveAttribute("href", "/review/opening-1/debug");
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

  describe("job count (#98)", () => {
    function renderCountBar(reviewId: string): void {
      render(
        <MemoryRouter initialEntries={[`/review/${reviewId}`]}>
          <ReviewBar
            reviewId={reviewId}
            guideOpen
            sourceOpen
            onToggleGuide={noop}
            onToggleSource={noop}
          />
        </MemoryRouter>,
      );
    }

    it("shows running and queued jobs and links to the Debug jobs list", async () => {
      // The mock demo seeds 1 running + 1 queued + 1 backing-off job.
      await renderBar("demo", "urllib3/urllib3#5020");
      const count = screen.getByRole("link", { name: "1 running, 2 queued" });
      expect(count).toHaveTextContent("1 · 2");
      expect(count).toHaveAttribute("href", "/review/demo/debug");
      expect(count).toHaveAttribute("title", "1 running, 2 queued");
      // Something runs: the animated gradient.
      expect(count.className).toContain("live");
    });

    it("is quiet with only queued jobs and hidden when idle", async () => {
      const snap = await api.review("demo");
      const live = (snap.jobs ?? []).filter(
        (j) => j.state === "running" || j.state === "queued" || j.state === "backing-off",
      );
      expect(live.length).toBeGreaterThan(0);
      // Queued-only: still shown, but quiet (no animated gradient).
      useReview.getState().setSnapshot({
        ...snap,
        jobs: live.map((j) => ({ ...j, state: "queued" as const })),
      });
      renderCountBar("demo");
      const quiet = screen.getByRole("link", { name: `0 running, ${live.length} queued` });
      expect(quiet).toHaveAttribute("href", "/review/demo/debug");
      expect(quiet.className).not.toContain("live");
      cleanup();
      // Idle: nothing renders, so no space is reserved.
      useReview.getState().setSnapshot({ ...snap, jobs: [] });
      renderCountBar("demo");
      expect(screen.queryByRole("link", { name: /running, .* queued/ })).toBeNull();
    });

    it("stays hidden while the review is still opening, even with live jobs", async () => {
      // The open itself is not a job (ingest state), so the count waits
      // for the finished open like the Debug icon does.
      const snap = await api.review("demo");
      useReview.getState().setSnapshot({
        ...snap,
        review: { ...snap.review, id: "opening-2", branch: "feature" },
        version: { ...snap.version, n: 0 },
        files: [],
        pages: [],
        ingest: { status: "loading", step: "fetching" },
        jobs: [{ id: "j1", kind: "explain", model: "m", priority: 1, state: "running" }],
      } as typeof snap);
      renderCountBar("opening-2");
      expect(screen.queryByRole("link", { name: /running, .* queued/ })).toBeNull();
    });
  });

  describe("version selector (#120)", () => {
    it("renders once in the bar for a multi-version review, hidden for one version", async () => {
      // r-old carries two versions; the demo only one.
      await renderBar("r-old", "urllib3/urllib3#5011");
      const switches = screen.getAllByTestId("version-switcher");
      expect(switches).toHaveLength(1);
      expect(document.getElementById("reviewbar")).toContainElement(switches[0]);
      const pick = screen.getByLabelText("View version") as HTMLSelectElement;
      expect(pick.value).toBe("2");
      expect(pick).toHaveClass("tbtn");
      // The current version is annotated in the dropdown.
      const texts = [...pick.options].map((o) => o.textContent);
      expect(texts).toContain("v2 · e4f5a6b7 · current");
      expect(texts).toContain("v1 · bdcc1e49");
      cleanup();
      useReview.getState().clear();
      await renderBar("demo", "urllib3/urllib3#5020");
      expect(screen.queryByTestId("version-switcher")).toBeNull();
    });

    it("stays in the bar with the guide pane hidden", async () => {
      useReview.getState().setSnapshot(await api.review("r-old"));
      render(
        <MemoryRouter initialEntries={["/review/r-old"]}>
          <ReviewBar reviewId="r-old" guideOpen={false} sourceOpen onToggleGuide={noop} onToggleSource={noop} />
        </MemoryRouter>,
      );
      await screen.findByText("urllib3/urllib3#5011", {}, { timeout: 5000 });
      expect(screen.getByTestId("version-switcher")).toBeInTheDocument();
    });

    it("flags an older shown version and annotates current as the way back", async () => {
      window.history.replaceState({}, "", "/review/r-old?version=1");
      try {
        useReview.getState().setSnapshot(await api.review("r-old"));
        render(
          <MemoryRouter initialEntries={["/review/r-old?version=1"]}>
            <ReviewBar reviewId="r-old" guideOpen sourceOpen onToggleGuide={noop} onToggleSource={noop} />
          </MemoryRouter>,
        );
        await screen.findByText("urllib3/urllib3#5011", {}, { timeout: 5000 });
        // The select shows the older version with the warning state; the
        // bar itself carries no notice and no back button.
        const switcher = screen.getByTestId("version-switcher");
        expect(switcher).toHaveAttribute("data-ro", "1");
        expect(screen.queryByRole("button", { name: "Back to current" })).toBeNull();
        expect(switcher).not.toHaveTextContent("read-only");
        const pick = screen.getByLabelText("View version") as HTMLSelectElement;
        expect(pick.value).toBe("1");
        const texts = [...pick.options].map((o) => o.textContent);
        expect(texts).toContain("v2 · e4f5a6b7 · current");
      } finally {
        window.history.replaceState({}, "", "/");
      }
    });
  });
});
