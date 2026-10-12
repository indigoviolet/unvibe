/**
 * CLI help (issue #86, finding 17): the help names every command —
 * including `version` and the no-arguments foreground start.
 */
import { describe, expect, it } from "vitest";
import { CLI_USAGE } from "../src/cli/commands.js";

describe("CLI_USAGE (finding 17)", () => {
  it("documents every command plus the no-command foreground start", () => {
    for (const cmd of [
      "start",
      "stop",
      "status",
      "setup",
      "open",
      "token",
      "doctor",
      "update",
      "version",
      "(no command)",
    ]) {
      expect(CLI_USAGE).toContain(cmd);
    }
    expect(CLI_USAGE).toContain("foreground");
  });
});
