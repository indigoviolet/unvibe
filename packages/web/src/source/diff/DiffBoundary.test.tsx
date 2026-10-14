/**
 * Per-file error boundaries (issue #101): a file section that throws shows
 * a file-shaped notice while the other files keep rendering.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Hunk, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { DiffView } from "./DiffView.js";

vi.mock("./FileSection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./FileSection.js")>();
  return {
    ...actual,
    FileSection: (props: { file: ReviewFile }) => {
      if (props.file.fileKey === "bad") throw new Error("file boom");
      return actual.FileSection(props as never);
    },
  };
});

const REVIEW_ID = "diff-boundary-test";

function hunk(hash: string): Hunk {
  return {
    contentHash: hash,
    header: "@@ -1 +1 @@",
    newStart: 1,
    newEnd: 1,
    oldStart: 1,
    oldEnd: 1,
    added: 1,
    removed: 0,
    lines: [{ kind: "add", newLine: 1, text: "x = 1" }],
  };
}

function file(fileKey: string, path: string): ReviewFile {
  return { fileKey, path, category: "source", hunks: [hunk(`hash-${fileKey}`)] };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "demo", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [file("good", "src/good.py"), file("bad", "src/bad.py")],
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  vi.restoreAllMocks();
});

describe("DiffView file boundaries", () => {
  test("a throw in one file leaves the other files rendered", () => {
    render(<DiffView reviewId={REVIEW_ID} />);
    expect(screen.getByText("good.py")).toBeInTheDocument();
    expect(screen.getByText("Couldn't show this file: something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/file boom/);
  });
});
