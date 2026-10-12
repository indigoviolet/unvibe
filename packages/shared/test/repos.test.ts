import { describe, expect, it } from "vitest";
import { parseGitHubRepoInput } from "../src/repos.js";

describe("parseGitHubRepoInput", () => {
  it.each([
    ["https://github.com/acme/app", { owner: "acme", name: "app" }],
    ["https://github.com/acme/app.git", { owner: "acme", name: "app" }],
    ["https://github.com/acme/app/", { owner: "acme", name: "app" }],
    ["https://github.com/acme/app.git/", { owner: "acme", name: "app" }],
    ["http://github.com/acme/app", { owner: "acme", name: "app" }],
    ["https://www.github.com/acme/app", { owner: "acme", name: "app" }],
    ["https://github.com/Acme/My-App.js?tab=readme#readme", { owner: "Acme", name: "My-App.js" }],
    ["git@github.com:acme/app.git", { owner: "acme", name: "app" }],
    ["git@github.com:acme/app", { owner: "acme", name: "app" }],
    ["ssh://git@github.com/acme/app.git", { owner: "acme", name: "app" }],
    ["acme/app", { owner: "acme", name: "app" }],
    ["acme/app/", { owner: "acme", name: "app" }],
    ["  acme/app  ", { owner: "acme", name: "app" }],
  ])("%s parses", (input, expected) => {
    expect(parseGitHubRepoInput(input)).toEqual(expected);
  });

  it.each([
    ["https://github.com/acme/app/pull/123", { owner: "acme", name: "app", prNumber: 123 }],
    ["https://github.com/acme/app/pull/123/", { owner: "acme", name: "app", prNumber: 123 }],
    ["https://github.com/acme/app/pull/123/files", { owner: "acme", name: "app", prNumber: 123 }],
    ["https://github.com/acme/app.git/pull/7", { owner: "acme", name: "app", prNumber: 7 }],
    ["acme/app#123", { owner: "acme", name: "app", prNumber: 123 }],
    ["acme/app#1", { owner: "acme", name: "app", prNumber: 1 }],
  ])("%s parses with PR number", (input, expected) => {
    expect(parseGitHubRepoInput(input)).toEqual(expected);
  });

  it.each([
    ["", /enter a GitHub repo/],
    ["   ", /enter a GitHub repo/],
    ["justastring", /not a GitHub repo URL or owner\/name/],
    ["acme", /not a GitHub repo URL or owner\/name/],
    ["acme/app/extra", /not a GitHub repo URL or owner\/name/],
    ["https://github.com/acme", /not a GitHub repo URL or owner\/name/],
    ["https://github.com/", /not a GitHub repo URL or owner\/name/],
    ["https://github.com", /not a GitHub repo URL or owner\/name/],
    ["https://example.com/acme/app", /only github\.com repos are supported/],
    ["git@example.com:acme/app.git", /only github\.com repos are supported/],
    ["https://github.com/acme/app/issues/5", /not a GitHub repo URL or owner\/name/],
    ["https://github.com/acme/app/pull/abc", /invalid PR number/],
    ["https://github.com/acme/app/pull/0", /invalid PR number/],
    ["acme/app#0", /invalid PR number/],
    ["acme/app#abc", /not a GitHub repo URL or owner\/name/],
    ["ftp://github.com/acme/app", /not a GitHub repo URL or owner\/name/],
    // Path/command safety: separators, traversal, flag-like names.
    ["../evil", /invalid owner|not a GitHub/],
    ["acme/../evil", /not a GitHub repo URL or owner\/name/],
    ["-evil/app", /invalid owner/],
    ["acme/-app", /invalid repo name/],
    ["acme/.hidden", /invalid repo name/],
    ["acme/a/b", /not a GitHub repo URL or owner\/name/],
    ["-acme/app", /invalid owner/],
    ["acme-/app", /invalid owner/],
    ["acme/", /not a GitHub repo URL or owner\/name/],
    ["/acme/app", /looks like a local path/],
    ["./app", /looks like a local path/],
    ["~/code/app", /looks like a local path/],
  ])("%s rejects", (input, expected) => {
    if (expected instanceof RegExp) {
      expect(() => parseGitHubRepoInput(input as string)).toThrow(expected);
    } else {
      expect(parseGitHubRepoInput(input as string)).toEqual(expected);
    }
  });

  it("rejects an overlong owner and name", () => {
    expect(() => parseGitHubRepoInput(`${"a".repeat(40)}/app`)).toThrow(/invalid owner/);
    expect(() => parseGitHubRepoInput(`acme/${"a".repeat(101)}`)).toThrow(/invalid repo name/);
  });
});
