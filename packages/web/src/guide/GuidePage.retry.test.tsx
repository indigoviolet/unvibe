/**
 * Guide error-state retry (issue #86, finding 14): "Couldn't build the
 * guide" offers Retry, which resumes the unfinished pipeline stages and
 * converges on the fresh snapshot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import * as ToastModule from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { GuidePage } from "./GuidePage.js";

const REVIEW_ID = "guide-retry";

function failedSnapshot(): ReviewSnapshot {
  return {
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    ingest: { status: "ready" },
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    pipeline: { stages: { reader: "error" }, errors: { reader: "agent exited" } },
  } as unknown as ReviewSnapshot;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={[`/review/${REVIEW_ID}`]}>
      <Routes>
        <Route path="/review/:reviewId/*" element={<GuidePage reviewId={REVIEW_ID} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
});

describe("GuidePage error retry (finding 14)", () => {
  it("retries the failed guide and shows the fresh snapshot", async () => {
    const healed = {
      ...failedSnapshot(),
      pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
      pipeline: { stages: { reader: "done" } },
    } as unknown as ReviewSnapshot;
    useReview.getState().setSnapshot(failedSnapshot());
    // The page's own load stays on the failure; only the post-retry
    // reload sees the healed snapshot.
    let healedVisible = false;
    vi.spyOn(api, "review").mockImplementation(async () => (healedVisible ? healed : failedSnapshot()));
    const resume = vi
      .spyOn(api, "resume")
      .mockResolvedValue({ resumed: true, jobIds: ["j1"], pendingStages: ["reader"] });
    renderPage();

    const retry = await screen.findByRole("button", { name: "Retry" });
    healedVisible = true;
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(resume).toHaveBeenCalledWith(REVIEW_ID);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
  });

  it("toasts when the retry itself fails", async () => {
    const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
    useReview.getState().setSnapshot(failedSnapshot());
    vi.spyOn(api, "review").mockImplementation(async () => failedSnapshot());
    vi.spyOn(api, "resume").mockRejectedValue(new Error('POST /api/reviews/x/resume: 400 {"error":"stuck"}'));
    renderPage();

    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("Couldn't retry the guide: stuck"));
    // The error state stays; the failure surfaces as a toast, not a crash.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
