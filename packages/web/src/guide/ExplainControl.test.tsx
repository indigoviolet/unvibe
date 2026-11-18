/**
 * The guide-side Explain row (issue #413): a ui Button beside the X
 * picker, the X shown once (in the picker, never repeated on the
 * button), no row when nothing earlier than the head exists, and an
 * explain run that stores nothing says so.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { ExplainControlSlot } from "./SinceSection.js";

const REVIEW_ID = "explain-row";
const OLD = "a".repeat(40);
const HEAD = "b".repeat(40);

function snapshot(opts: { versions: number; commits: string[] }): ReviewSnapshot {
  const versions = Array.from({ length: opts.versions }, (_, i) => ({
    n: i + 1,
    headSha: i + 1 === opts.versions ? HEAD : OLD,
    mergeBaseSha: "c".repeat(40),
    baseRef: "main",
    fetchedAt: 0,
  }));
  return {
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions, currentVersion: opts.versions, guidePersonaId: "guide", createdAt: 0 },
    version: { n: opts.versions, headSha: HEAD, mergeBaseSha: "c".repeat(40), baseRef: "main", fetchedAt: 0, idMapping: {} },
    commits: opts.commits.map((sha, i) => ({ sha, subject: `commit ${i + 1}` })),
    files: [],
    pages: [],
    ingest: { status: "ready" },
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useReview.setState({ snapshot: null }));
});

describe("Explain row (#413)", () => {
  it("is a primary ui Button reading 'Explain changes'; the default X shows in the picker only", () => {
    act(() => useReview.setState({ snapshot: null }));
    act(() => useReview.getState().setSnapshot(snapshot({ versions: 2, commits: [OLD, HEAD] })));
    render(<ExplainControlSlot reviewId={REVIEW_ID} />);
    const btn = screen.getByTestId("explain-button");
    expect(btn).toHaveTextContent(/^Explain changes$/);
    expect(btn).toHaveClass("ui-btn");
    expect(btn).toHaveAttribute("data-variant", "primary");
    expect(btn).not.toHaveClass("x");
    expect(btn).toBeEnabled();
    // The default (the previous version) is preselected as a real choice.
    expect(screen.getByTestId("explain-pick")).toHaveTextContent("v1");
    // No floating label text in the row.
    expect(screen.getByTestId("explain-control")).not.toHaveTextContent(/Explain what changed/);
  });

  it("renders no row when the only choice would be the head", () => {
    act(() => useReview.setState({ snapshot: null }));
    act(() => useReview.getState().setSnapshot(snapshot({ versions: 1, commits: [HEAD] })));
    render(<ExplainControlSlot reviewId={REVIEW_ID} />);
    expect(screen.queryByTestId("explain-control")).toBeNull();
    expect(screen.queryByTestId("explain-pick")).toBeNull();
  });

  it("an explain run that stores nothing says 'No changes to explain since X'", async () => {
    const snap = snapshot({ versions: 2, commits: [OLD, HEAD] });
    act(() => useReview.setState({ snapshot: null }));
    act(() => useReview.getState().setSnapshot(snap));
    vi.spyOn(api, "explain").mockResolvedValue({ jobId: "j1", toVersion: 2 } as never);
    vi.spyOn(api, "job").mockResolvedValue({ job: { id: "j1", state: "done" } } as never);
    vi.spyOn(api, "review").mockResolvedValue(snap);
    render(<ExplainControlSlot reviewId={REVIEW_ID} />);
    fireEvent.click(screen.getByTestId("explain-button"));
    const empty = await screen.findByTestId("explain-empty", undefined, { timeout: 10_000 });
    expect(empty).toHaveTextContent("No changes to explain since v1");
    expect(empty).toHaveAttribute("role", "status");
    await waitFor(() => expect(api.explain).toHaveBeenCalledWith(REVIEW_ID, { version: 1 }));
  });
});
