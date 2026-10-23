/**
 * Re-do guide section (#115): confirmation, navigation, and when the
 * control is not offered (demo, loading, failed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { RedoGuideSection } from "./RedoGuideSection.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function snapshot(reviewId: string, repoId = "urllib3", ingest?: ReviewSnapshot["ingest"]): ReviewSnapshot {
  return {
    review: { id: reviewId, repoId, branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ...(ingest ? { ingest } : {}),
  } as unknown as ReviewSnapshot;
}

function loadingSnapshot(reviewId: string): ReviewSnapshot {
  return {
    review: { id: reviewId, repoId: "urllib3", branch: "feature", versions: [], currentVersion: 0, createdAt: 0 },
    version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "loading", step: "fetching" },
  } as unknown as ReviewSnapshot;
}

function Location(): React.JSX.Element {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function renderSection(reviewId: string): void {
  render(
    <MemoryRouter initialEntries={[`/review/${reviewId}/debug`]}>
      <Location />
      <RedoGuideSection reviewId={reviewId} />
    </MemoryRouter>,
  );
}

describe("RedoGuideSection", () => {
  it("carries the caption as the button's tooltip, with no inline caption (#237)", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1"));
    renderSection("r1");

    const button = await screen.findByRole("button", { name: "Re-do guide" });
    expect(button).toHaveAttribute("title", "Start the guide over from the same change.");
    expect(screen.queryByText("Start the guide over from the same change.")).toBeNull();
  });

  it("confirms, then navigates to the new loading review", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1"));
    const redo = vi.spyOn(api, "redoReview").mockResolvedValue(loadingSnapshot("r2"));
    renderSection("r1");

    fireEvent.click(await screen.findByRole("button", { name: "Re-do guide" }));
    await screen.findByText(/Anything already on GitHub stays there\./);
    fireEvent.click(screen.getByRole("button", { name: "Re-do guide" }));

    await waitFor(() => expect(redo).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/review/r2"));
  });

  it("cancel closes the confirmation without calling", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1"));
    const redo = vi.spyOn(api, "redoReview").mockResolvedValue(loadingSnapshot("r2"));
    renderSection("r1");

    fireEvent.click(await screen.findByRole("button", { name: "Re-do guide" }));
    await screen.findByText(/open this change again as a new review\?/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText(/open this change again as a new review\?/)).toBeNull(),
    );
    expect(redo).not.toHaveBeenCalled();
    expect(screen.getByTestId("loc")).toHaveTextContent("/review/r1/debug");
  });

  it("shows a refusal reason when the service refuses", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1"));
    vi.spyOn(api, "redoReview").mockRejectedValue(new Error("POST /api/reviews/r1/redo: 409 busy"));
    renderSection("r1");

    fireEvent.click(await screen.findByRole("button", { name: "Re-do guide" }));
    await screen.findByText(/open this change again as a new review\?/);
    fireEvent.click(screen.getByRole("button", { name: "Re-do guide" }));
    await screen.findByText(/Couldn't re-do the guide/);
    expect(screen.getByTestId("loc")).toHaveTextContent("/review/r1/debug");
  });

  it("is not offered for the demo review", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("demo", "demo"));
    renderSection("demo");
    await waitFor(() => expect(api.review).toHaveBeenCalled());
    // Let the section settle, then assert nothing rendered.
    await screen.findByTestId("loc");
    expect(screen.queryByRole("button", { name: "Re-do guide" })).toBeNull();
  });

  it("is disabled with a reason while the review is still opening", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1", "urllib3", { status: "loading", step: "fetching" }));
    renderSection("r1");

    const button = await screen.findByRole("button", { name: "Re-do guide" });
    expect(button).toBeDisabled();
    expect(screen.getByText("The review is still opening.")).toBeVisible();
  });

  it("is not offered when the review failed to open", async () => {
    vi.spyOn(api, "review").mockResolvedValue(snapshot("r1", "urllib3", { status: "failed", error: "boom" }));
    renderSection("r1");
    await waitFor(() => expect(api.review).toHaveBeenCalled());
    await screen.findByTestId("loc");
    expect(screen.queryByRole("button", { name: "Re-do guide" })).toBeNull();
  });
});
