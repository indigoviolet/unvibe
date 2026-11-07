import { describe, expect, it } from "vitest";
import { formatId, parseId } from "../src/ids.js";

describe("parseId", () => {
  it("parses full diff ids", () => {
    expect(parseId("diff:conn:147-152@abc123")).toEqual({
      kind: "diff",
      fileKey: "conn",
      start: 147,
      end: 152,
      sha: "abc123",
    });
  });

  it("parses short diff ids (no @sha)", () => {
    expect(parseId("diff:sp:147")).toEqual({
      kind: "diff",
      fileKey: "sp",
      start: 147,
      end: 147,
      sha: undefined,
    });
  });

  it("parses hunk ids", () => {
    expect(parseId("h:conn:deadbeef")).toEqual({
      kind: "h",
      fileKey: "conn",
      contentHash: "deadbeef",
    });
  });

  it("parses code ids with colon paths", () => {
    expect(parseId("code:src/a:b.py:10-20@abc123")).toEqual({
      kind: "code",
      path: "src/a:b.py",
      start: 10,
      end: 20,
      sha: "abc123",
    });
  });

  it("parses desc ids with and without rev", () => {
    expect(parseId("desc:d-table@3")).toEqual({ kind: "desc", paragraph: "d-table", rev: "3" });
    expect(parseId("desc:d-table")).toEqual({ kind: "desc", paragraph: "d-table", rev: undefined });
  });

  it("parses card ids with optional block", () => {
    expect(parseId("card:central#p-rule")).toEqual({
      kind: "card",
      cardId: "central",
      blockId: "p-rule",
    });
    expect(parseId("card:central")).toEqual({ kind: "card", cardId: "central", blockId: undefined });
  });

  it("parses page, concept and ann ids", () => {
    expect(parseId("page:f-522")).toEqual({ kind: "page", pageId: "f-522" });
    expect(parseId("concept:idempotency")).toEqual({ kind: "concept", slug: "idempotency" });
    expect(parseId("ann:x1")).toEqual({ kind: "ann", id: "x1" });
  });

  it("parses stable reply ids (issue #365)", () => {
    expect(parseId("ann:x1#r2")).toEqual({ kind: "ann", id: "x1", reply: 2 });
    expect(formatId(parseId("ann:x1#r2")!)).toBe("ann:x1#r2");
    expect(formatId(parseId("ann:x1")!)).toBe("ann:x1");
    // Malformed reply suffixes are not IDs.
    for (const bad of ["ann:x1#r0", "ann:x1#r", "ann:x1#b2", "ann:x1#r2#r3", "ann:#r2"]) {
      expect(parseId(bad), bad).toBeNull();
    }
  });

  it("parses code ids whose paths contain brackets, @, +, ~ (issue #332)", () => {
    expect(parseId("code:src/app/(group)/items/[id]/page.tsx:433-492")).toEqual({
      kind: "code",
      path: "src/app/(group)/items/[id]/page.tsx",
      start: 433,
      end: 492,
      sha: undefined,
    });
    expect(parseId("code:dir/[...slug]/route.ts:1-5")).toEqual({
      kind: "code",
      path: "dir/[...slug]/route.ts",
      start: 1,
      end: 5,
      sha: undefined,
    });
    expect(parseId("code:pkg/@scope/x.ts:10-20")).toEqual({
      kind: "code",
      path: "pkg/@scope/x.ts",
      start: 10,
      end: 20,
      sha: undefined,
    });
    expect(parseId("code:pkg/@scope/x.ts:10-20@abc123")).toEqual({
      kind: "code",
      path: "pkg/@scope/x.ts",
      start: 10,
      end: 20,
      sha: "abc123",
    });
    expect(parseId("code:a+b/c~d.ts:3")).toEqual({
      kind: "code",
      path: "a+b/c~d.ts",
      start: 3,
      end: 3,
      sha: undefined,
    });
  });

  it("rejects malformed ids", () => {
    expect(parseId("")).toBeNull();
    expect(parseId("nope")).toBeNull();
    expect(parseId("bogus:1:2")).toBeNull();
    expect(parseId("diff:conn:0@abc")).toBeNull(); // line 0 invalid
    expect(parseId("diff:conn:9-3@abc1")).toBeNull(); // inverted range
    expect(parseId("diff:conn:x@abc1")).toBeNull();
    expect(parseId("page:a:b")).toBeNull();
  });
});

describe("formatId", () => {
  it("round-trips full ids", () => {
    for (const s of [
      "diff:conn:147-152@abc123",
      "h:conn:deadbeef",
      "code:src/x.py:10-20@abc123",
      "desc:d-table@3",
      "card:central#p-rule",
      "page:f-522",
      "concept:idempotency",
      "ann:x1",
    ]) {
      expect(formatId(parseId(s)!)).toBe(s);
    }
  });

  it("short form drops the sha/rev suffix", () => {
    expect(formatId(parseId("diff:conn:147-152@abc123")!, { short: true })).toBe(
      "diff:conn:147-152",
    );
    expect(formatId(parseId("code:src/x.py:10@abc123")!, { short: true })).toBe(
      "code:src/x.py:10",
    );
    expect(formatId(parseId("desc:d-table@3")!, { short: true })).toBe("desc:d-table");
    // Non-sha kinds are unaffected by short.
    expect(formatId(parseId("card:central#p-rule")!, { short: true })).toBe(
      "card:central#p-rule",
    );
  });
});
