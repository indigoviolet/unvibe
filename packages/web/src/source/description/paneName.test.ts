/**
 * Description-pane naming (issue #86, finding 22): "Commits" for a
 * branch review (no PR), "PR description" for a PR review.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { descriptionPaneName } from "./paneName.js";

function snapshot(prNumber?: number): ReviewSnapshot {
  return {
    review: {
      id: "r1",
      repoId: "r",
      branch: "b",
      ...(prNumber !== undefined ? { prNumber } : {}),
      versions: [],
      currentVersion: 1,
      createdAt: 0,
    },
  } as unknown as ReviewSnapshot;
}

describe("descriptionPaneName (finding 22)", () => {
  it("names the PR tab for PR reviews", () => {
    expect(descriptionPaneName(snapshot(12))).toBe("PR description");
  });

  it("names the Commits tab for branch reviews", () => {
    expect(descriptionPaneName(snapshot())).toBe("Commits");
  });

  it("keeps the old name when the snapshot is unknown", () => {
    expect(descriptionPaneName(null)).toBe("PR description");
    expect(descriptionPaneName(undefined)).toBe("PR description");
  });
});
