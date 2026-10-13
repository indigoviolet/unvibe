/**
 * Correction cites (issue #86, finding 12): the "cites:" line shows the
 * resolved file:line label, never the raw citation id.
 */
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Card, Contribution, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { CorrectionSuggestion } from "./CorrectionSuggestion.js";

const CONN = "src-urllib3-connection.py";

function seed(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: "r1", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [
      {
        fileKey: CONN,
        path: "src/urllib3/connection.py",
        category: "source",
        hunks: [
          {
            contentHash: "abc",
            header: "@@ -80,10 +80,10 @@",
            newStart: 80,
            newEnd: 89,
            oldStart: 80,
            oldEnd: 89,
            added: 1,
            removed: 1,
            lines: [{ kind: "ctx", oldLine: 80, newLine: 80, text: "x = 1" }],
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

const CARD = { id: "c1" } as unknown as Card;

function contribution(): Contribution[] {
  return [
    {
      id: "ct1",
      sourceSession: "s1",
      status: "pending",
      items: [
        {
          kind: "correction",
          text: "Fix the timeout.",
          target: "card:c1",
          citations: [{ target: `diff:${CONN}:80` }],
        },
      ],
    },
  ];
}

describe("CorrectionSuggestion cites (finding 12)", () => {
  it("shows the resolved file:line label instead of the raw citation id", () => {
    seed();
    try {
      render(<CorrectionSuggestion reviewId="r1" card={CARD} contributions={contribution()} />);
      expect(screen.getByText("connection.py:80")).toBeInTheDocument();
      expect(screen.queryByText(`diff:${CONN}:80`)).not.toBeInTheDocument();
    } finally {
      cleanup();
    }
  });
});
