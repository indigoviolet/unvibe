import { describe, expect, it } from "vitest";
import { DEFAULT_GUIDE_TITLE, isDefaultGuideTitle } from "../src/guide.js";

describe("isDefaultGuideTitle", () => {
  it("treats only the current default as the default", () => {
    expect(DEFAULT_GUIDE_TITLE).toBe("Guide");
    expect(isDefaultGuideTitle("Guide")).toBe(true);
    expect(isDefaultGuideTitle("Guided review")).toBe(false);
  });

  it("rejects real titles and empty input", () => {
    expect(isDefaultGuideTitle("Unfold obsolete folded response headers")).toBe(false);
    expect(isDefaultGuideTitle(" guide ")).toBe(false);
    expect(isDefaultGuideTitle("GUIDE")).toBe(false);
    expect(isDefaultGuideTitle("")).toBe(false);
    expect(isDefaultGuideTitle(null)).toBe(false);
    expect(isDefaultGuideTitle(undefined)).toBe(false);
  });
});
