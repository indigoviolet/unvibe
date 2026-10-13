// DISABLED(#119): restates the PROMPT_TEMPLATE_NAMES constant; service prompts.test.ts:98 checks templates and names agree.
import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_NAMES } from "../src/prompts.js";

describe("prompt contract (additive, PRD §13)", () => {
  it("names every template in the PRD §13 table", () => {
    expect(PROMPT_TEMPLATE_NAMES).toHaveLength(17);
    for (const name of [
      "instructions",
      "reader",
      "base_pack",
      "critic",
      "hunk_pass",
      "concept_stub",
      "concept_page",
      "explain",
      "ask",
      "depth",
      "examples",
      "diagram",
      "go_deeper",
      "update_pass",
      "consolidate",
      "second_opinion_blind",
      "second_opinion_check",
    ] as const) {
      expect(PROMPT_TEMPLATE_NAMES).toContain(name);
    }
  });
});
