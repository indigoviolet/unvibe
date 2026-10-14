/**
 * Release-notes install story (issue #156).
 *
 * The repository is public: installing needs no GitHub login. The
 * generated text comes back in every release until fixed, so pin it here:
 * this static guard fails if `scripts/release-notes.mjs` ever says the
 * repo is private again.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");

describe("release notes assume a public repository", () => {
  it("mentions no private repo, credential setup or authenticated download", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "release-notes.mjs"), "utf8");
    expect(script).not.toMatch(/private/i);
    expect(script).not.toContain("setup-git");
    expect(script).not.toContain("gh release download");
    expect(script).toMatch(/no login/i);
  });
});
