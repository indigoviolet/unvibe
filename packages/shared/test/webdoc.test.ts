import { describe, expect, it } from "vitest";
import {
  QUOTE_GONE_LABEL, captureHash, pageKey, parseRepoCodeCitation,
  quoteClickResult, quoteOnPage, repoCodeCitation,
} from "../src/webdoc.js";

describe("webdoc (#322)", () => {
  it("pageKey: one thread per page (no query/fragment, lower host)", () => {
    expect(pageKey("https://GitHub.com/acme/app/pull/1?x=1#y")).toBe("https://github.com/acme/app/pull/1");
    expect(pageKey("https://github.com/acme/app/")).toBe("https://github.com/acme/app");
  });
  it("repo-qualified citations round-trip", () => {
    const c = repoCodeCitation({ owner: "acme", name: "service" }, "src/auth.ts", 3, 7);
    expect(c).toBe("code:acme/service:src/auth.ts:3-7");
    expect(parseRepoCodeCitation(c)).toEqual({ slug: "acme/service", path: "src/auth.ts", start: 3, end: 7 });
    expect(parseRepoCodeCitation("code:src/auth.ts:1-2")).toBeNull();
  });
  it("staleness: hash changes with page text; quote click says gone", () => {
    expect(captureHash("hello")).not.toBe(captureHash("hello changed"));
    expect(quoteOnPage("the quick fox", "the quick  fox jumps")).toBe(true);
    expect(quoteClickResult("gone text", "the page changed")).toBe("gone");
    expect(QUOTE_GONE_LABEL).toBe("not on the page any more");
  });
});
