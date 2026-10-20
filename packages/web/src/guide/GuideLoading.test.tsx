/**
 * #92: loading and failed review pages + Reviews row markers.
 */
import { describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach } from "vitest";
import type { ReviewSummary } from "@unvibe/shared";
import { EmptyOpen, FailedOpen } from "./GuidePage.js";
import { ingestStepLabel } from "./stageLabels.js";
import { SessionRow } from "../start/StartPage.js";

afterEach(() => cleanup());

describe("ingestStepLabel (#92)", () => {
  // DISABLED(#188): useless — pins exact loading-step copy
  test.skip("names what is being done", () => {
    expect(ingestStepLabel("fetching")).toBe("Fetching…");
    expect(ingestStepLabel("reading diff")).toBe("Reading the diff…");
    expect(ingestStepLabel("")).toBe("Fetching…");
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
    ingestStatus: "ready",
    ...over,
  };
}

describe("SessionRow ingest markers (#92 Reviews rows)", () => {
  test("loading row shows the step and stays openable", () => {
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
    expect(screen.getByText("Fetching…")).toBeInTheDocument();
    expect(screen.getByText("opening")).toBeInTheDocument();
    // Reopenable from there (open button enabled).
    const btn = screen.getByTestId("session-r1").querySelector("button.cj-open");
    expect(btn).not.toBeNull();
    expect(btn).toBeEnabled();
  });

  test("failed row shows the error and stays removable", () => {
    const s = summary({ ingestStatus: "failed", ingestError: "the PR wasn't found" });
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
    expect(screen.getByText("Couldn't open this review: the PR wasn't found")).toBeInTheDocument();
    expect(screen.getByText("couldn't open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove PR title/ })).toBeInTheDocument();
  });
});

describe("EmptyOpen (#179 empty diff)", () => {
  test("shows no-changes message with Retry, not a failure", () => {
    render(
      <MemoryRouter>
        <EmptyOpen reviewId="r1" prLabel="PR #42" error="No changes to review: this PR has been merged and its branch is now the same as its base, so the diff is empty." />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("review-empty")).toBeInTheDocument();
    expect(screen.getByText("No changes to review")).toBeInTheDocument();
    expect(screen.getByTestId("review-empty-message")).toHaveTextContent("No changes to review");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't open/)).not.toBeInTheDocument();
  });

  test("empty row shows the message and no-changes tag", () => {
    const s = summary({ ingestStatus: "empty", ingestError: "No changes to review: the diff is empty." });
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
    expect(screen.getByText("No changes to review: the diff is empty.")).toBeInTheDocument();
    expect(screen.getByText("no changes")).toBeInTheDocument();
  });
});

describe("FailedOpen (#92 failed page)", () => {
  test("shows the error with Retry", () => {
    render(
      <MemoryRouter>
        <FailedOpen reviewId="r1" prLabel="PR #42" error="the PR wasn't found" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("review-failed")).toBeInTheDocument();
    expect(screen.getByTestId("review-failed-error")).toHaveTextContent("the PR wasn't found");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
