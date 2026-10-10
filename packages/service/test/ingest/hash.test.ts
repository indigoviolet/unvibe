/**
 * Hunk content-hash stability (PRD §8): same content at shifted line
 * numbers and with whitespace churn hashes the same; any real content
 * change (including add/del kind flips) does not.
 */
import { describe, expect, it } from "vitest";
import { hashHunkLines } from "../../src/ingest/hash.js";
import type { ParsedHunkLine } from "../../src/ingest/diff.js";

const base: ParsedHunkLine[] = [
  { kind: "ctx", oldLine: 77, newLine: 77, text: "RECENT_DATE = datetime.date(2025, 1, 1)" },
  { kind: "del", oldLine: 78, text: "headers = HTTPHeaderDict(httplib_response.msg.items())" },
  { kind: "add", newLine: 78, text: "header_items = _normalize_header_values(httplib_response.msg)" },
  { kind: "add", newLine: 79, text: "headers = HTTPHeaderDict(header_items)" },
];

const shifted: ParsedHunkLine[] = base.map((l) => ({
  ...l,
  oldLine: l.oldLine === undefined ? undefined : l.oldLine + 500,
  newLine: l.newLine === undefined ? undefined : l.newLine + 500,
}));

const reindented: ParsedHunkLine[] = base.map((l) => ({ ...l, text: `    ${l.text}   ` }));

const tabbed: ParsedHunkLine[] = base.map((l) => ({ ...l, text: `\t${l.text.replace(/ /g, "  ")}\t` }));

describe("hashHunkLines", () => {
  it("ignores line numbers", () => {
    expect(hashHunkLines(shifted)).toBe(hashHunkLines(base));
  });

  it("ignores whitespace changes", () => {
    expect(hashHunkLines(reindented)).toBe(hashHunkLines(base));
    expect(hashHunkLines(tabbed)).toBe(hashHunkLines(base));
  });

  it("changes on real content edits", () => {
    const edited = base.map((l, i) =>
      i === 2 ? { ...l, text: "header_items = something_else(httplib_response.msg)" } : l,
    );
    expect(hashHunkLines(edited)).not.toBe(hashHunkLines(base));
  });

  it("changes on add/del kind flips", () => {
    const flipped = base.map((l) =>
      l.kind === "add" ? { ...l, kind: "del" as const } : l,
    );
    expect(hashHunkLines(flipped)).not.toBe(hashHunkLines(base));
  });

  it("is a 16-char hex string", () => {
    expect(hashHunkLines(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});
