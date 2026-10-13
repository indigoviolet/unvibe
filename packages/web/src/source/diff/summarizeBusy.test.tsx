/**
 * Hunk summarize busy state (issue #63): clicking Summarize shows dots
 * (`aria-label="Summarizing"`) until the summary lands through a patch —
 * never stuck next to the fresh summary. Any landed summary settles the
 * request (#137: landed text is shown as-is, never hidden as absent);
 * a failed request clears the dots and re-offers Summarize.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReviewSnapshot } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { DiffView } from "./DiffView.js";

const HASH = "h63";

function seed(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: "r63", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "a", mergeBaseSha: "d", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [
      {
        fileKey: "a-py",
        path: "src/a.py",
        category: "source",
        hunks: [
          {
            contentHash: HASH,
            header: "@@ -1,2 +1,3 @@",
            newStart: 1,
            newEnd: 3,
            oldStart: 1,
            oldEnd: 2,
            added: 1,
            removed: 0,
            lines: [
              { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
              { kind: "add", newLine: 2, text: "y = 2" },
              { kind: "ctx", oldLine: 2, newLine: 3, text: "z = 3" },
            ],
          },
        ],
      },
    ],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function landSummary(summary: string): void {
  act(() => {
    const snap = useReview.getState().snapshot!;
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: snap.rev,
      headRev: snap.rev + 1,
      ops: [
        {
          op: "replace",
          path: "/hunkStates",
          value: [{ contentHash: HASH, folded: false, reviewed: false, summary }],
        },
      ],
    });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
});

describe("summarize busy dots (#63)", () => {
  test("held request shows dots; the landed summary clears them", async () => {
    seed();
    let resolveReq!: (v: { jobId: string }) => void;
    vi.spyOn(api, "summarizeHunk").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReq = resolve as never;
        }),
    );
    render(<DiffView reviewId="r63" />);
    await screen.findByText("Hunk 1 of 1");
    fireEvent.click(screen.getByRole("button", { name: "Summarize with agent" }));
    expect(await screen.findByLabelText("Summarizing")).toBeInTheDocument();
    // The request settles (202, job running) but the summary is not here
    // yet: the dots correctly stay until it lands by patch.
    act(() => {
      resolveReq({ jobId: "job-1" });
    });
    await Promise.resolve();
    expect(screen.getByLabelText("Summarizing")).toBeInTheDocument();
    landSummary("Fresh summary");
    expect(await screen.findByText("Fresh summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Summarizing")).toBeNull();
  });

  test("a landed summary that looks like JSON clears the dots and shows as-is (#137)", async () => {
    seed();
    let resolveReq!: (v: { jobId: string }) => void;
    vi.spyOn(api, "summarizeHunk").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReq = resolve as never;
        }),
    );
    render(<DiffView reviewId="r63" />);
    await screen.findByText("Hunk 1 of 1");
    fireEvent.click(screen.getByRole("button", { name: "Summarize with agent" }));
    expect(await screen.findByLabelText("Summarizing")).toBeInTheDocument();
    act(() => {
      resolveReq({ jobId: "job-1" });
    });
    await Promise.resolve();
    landSummary(`{"hunk": {"summary": "Maps the Nav 2 Conversations item`);
    // #137: no display filter — the landed text is shown as-is, and the
    // dots clear because the summary landed.
    expect(await screen.findByText(/"hunk"/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Summarizing")).toBeNull();
  });

  test("a failed request clears the dots and re-offers Summarize", async () => {
    seed();
    let rejectReq!: (err: Error) => void;
    vi.spyOn(api, "summarizeHunk").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectReq = reject as never;
        }),
    );
    render(<DiffView reviewId="r63" />);
    await screen.findByText("Hunk 1 of 1");
    fireEvent.click(screen.getByRole("button", { name: "Summarize with agent" }));
    expect(await screen.findByLabelText("Summarizing")).toBeInTheDocument();
    act(() => {
      rejectReq(new Error("no agent configured"));
    });
    expect(await screen.findByRole("button", { name: "Summarize with agent" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Summarizing")).toBeNull();
  });
});
