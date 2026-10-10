import { describe, expect, test } from "vitest";
import { canEditDescription } from "./canEdit.js";

describe("canEditDescription", () => {
  test("author + open PR + flag", () => {
    expect(
      canEditDescription({ source: "pr", editable: true, author: "you", state: "OPEN" }, "you"),
    ).toBe(true);
  });

  test("someone else's PR is read-only for a known viewer", () => {
    expect(
      canEditDescription({ source: "pr", editable: true, author: "teammate", state: "OPEN" }, "you"),
    ).toBe(false);
  });

  test("merged PRs are read-only", () => {
    expect(
      canEditDescription({ source: "pr", editable: true, author: "you", state: "MERGED" }, "you"),
    ).toBe(false);
  });

  test("branches without a PR are read-only", () => {
    expect(canEditDescription({ source: "commits", editable: false }, "you")).toBe(false);
  });

  test("unknown viewer falls back to the service flag", () => {
    expect(canEditDescription({ source: "pr", editable: true, author: "you", state: "OPEN" }, null)).toBe(
      true,
    );
    expect(canEditDescription({ source: "pr", editable: false }, null)).toBe(false);
  });
});
