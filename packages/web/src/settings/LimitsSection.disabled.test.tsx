// DISABLED(#188): covered by J5
/**
 * Limits validation errors (issue #86, finding 11): the service names
 * the internal key; the UI shows the field's label instead.
 */
import { describe, expect, it } from "vitest";
import { labelError, type Field } from "./LimitsSection.js";

const SESSIONS: Field = { key: "sessionsPerProvider", label: "Agent sessions at once, per provider", hint: "" };

describe("labelError", () => {
  it("replaces the internal key prefix with the field label", () => {
    expect(labelError(SESSIONS, "sessionsPerProvider must be an integer in [1, 32]")).toBe(
      "Agent sessions at once, per provider: must be an integer in [1, 32]",
    );
  });

  it("leaves messages that already start with the label alone", () => {
    expect(labelError(SESSIONS, "Agent sessions at once, per provider: enter a number")).toBe(
      "Agent sessions at once, per provider: enter a number",
    );
  });

  it("leaves unrelated errors alone", () => {
    expect(labelError(SESSIONS, "unknown setting: nope")).toBe("unknown setting: nope");
  });
});
