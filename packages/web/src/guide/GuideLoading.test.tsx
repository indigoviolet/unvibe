/**
 * #92: loading and failed review pages + Previous reviews row markers.
 */
import { describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach } from "vitest";
import type { ReviewSummary } from "@unvibe/shared";
import { FailedOpen, loadingStepLabel } from "./GuidePage.js";
import { SessionRow } from "../start/StartPage.js";

afterEach(() => cleanup());

describe("loadingStepLabel (#92)", () => {
  test("names what is being done", () => {
    expect(loadingStepLabel("fetching")).toBe("Fetching…");
    expect(loadingStepLabel("reading diff")).toBe("Reading the diff…");
    expect(loadingStepLabel("")).toBe("Fetching…");
  });
});

function summary(over: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    id: "r1",
    repoId: "repo1",
    repoOwner: "acme",
    repoName: "app",
    title: "PR title",
    branch: "feature",
    prNumber: 42,
    createdAt: Date.now(),
    lastOpened: Date.now(),
    versionCount: 0,
    currentVersion: 0,
    stale: false,
    totalHunks: 0,
    reviewedHunks: 0,
    pendingComments: 0,
    guideStatus: "idle",
    ...over,
  };
}

describe("SessionRow ingest markers (#92 Previous reviews)", () => {
  test("loading row shows loading + step and stays openable", () => {
    const s = summary({ ingestStatus: "loading", ingestStep: "fetching" });
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <SessionRow
          s={s}
          opening={null}
          deleting={null}
          confirmDelete={null}
          setConfirmDelete={() => {}}
          removeSession={async () => {}}
          onOpen={onOpen}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Loading.*fetching/i)).toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    // Reopenable from there (open button enabled).
    const btn = screen.getByTestId("session-r1").querySelector("button.cj");
    expect(btn).not.toBeNull();
    expect(btn).toBeEnabled();
  });

  test("failed row shows the error and stays removable", () => {
    const s = summary({ ingestStatus: "failed", ingestError: "gh pr view failed" });
    render(
      <MemoryRouter>
        <SessionRow
          s={s}
          opening={null}
          deleting={null}
          confirmDelete={null}
          setConfirmDelete={() => {}}
          removeSession={async () => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Couldn't open/i)).toBeInTheDocument();
    expect(screen.getByText("failed to open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove PR title/ })).toBeInTheDocument();
  });
});

describe("FailedOpen (#92 failed page)", () => {
  test("shows the error with Retry and a way back", () => {
    render(
      <MemoryRouter>
        <FailedOpen reviewId="r1" prLabel="PR #42" error="gh pr view failed: not found" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("review-failed")).toBeInTheDocument();
    expect(screen.getByTestId("review-failed-error")).toHaveTextContent("gh pr view failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to start" })).toBeInTheDocument();
  });
});
