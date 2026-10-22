/**
 * #230: the displayed review decision — approved, changes_requested when
 * not re-requested, otherwise no decision. review_required never shows.
 */
import { describe, expect, it } from "vitest";
import { displayedReviewDecision, prReviewDecisionFromGh } from "../src/entities.js";

describe("prReviewDecisionFromGh (#230: review_required dropped)", () => {
  it("maps APPROVED and CHANGES_REQUESTED, drops REVIEW_REQUIRED", () => {
    expect(prReviewDecisionFromGh("APPROVED")).toBe("approved");
    expect(prReviewDecisionFromGh("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(prReviewDecisionFromGh("REVIEW_REQUIRED")).toBeUndefined();
    expect(prReviewDecisionFromGh("")).toBeUndefined();
  });
});

describe("displayedReviewDecision (#230)", () => {
  it("approved always shows", () => {
    expect(displayedReviewDecision({ reviewDecision: "APPROVED" })).toBe("approved");
    expect(
      displayedReviewDecision({
        reviewDecision: "APPROVED",
        reviewRequests: [{ login: "alice" }],
        latestReviews: [{ author: { login: "alice" }, state: "APPROVED" }],
      }),
    ).toBe("approved");
  });

  it("review_required and empty never show", () => {
    expect(displayedReviewDecision({ reviewDecision: "REVIEW_REQUIRED" })).toBeUndefined();
    expect(displayedReviewDecision({ reviewDecision: "" })).toBeUndefined();
    expect(displayedReviewDecision({})).toBeUndefined();
  });

  it("changes_requested shows when not re-requested", () => {
    expect(displayedReviewDecision({ reviewDecision: "CHANGES_REQUESTED" })).toBe("changes_requested");
    expect(
      displayedReviewDecision({
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequests: [{ login: "bob" }],
        latestReviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
      }),
    ).toBe("changes_requested");
  });

  it("changes_requested hides when the requester was re-requested", () => {
    expect(
      displayedReviewDecision({
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequests: [{ login: "alice" }],
        latestReviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
      }),
    ).toBeUndefined();
  });

  it("re-request match is case-insensitive", () => {
    expect(
      displayedReviewDecision({
        reviewDecision: "changes_requested",
        reviewRequests: [{ login: "Alice" }],
        latestReviews: [{ author: { login: "alice" }, state: "changes_requested" }],
      }),
    ).toBeUndefined();
  });

  it("team-only requests do not hide a user's changes_requested", () => {
    expect(
      displayedReviewDecision({
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequests: [{ slug: "core-team" }],
        latestReviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
      }),
    ).toBe("changes_requested");
  });
});
