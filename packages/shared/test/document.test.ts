import { describe, expect, it } from "vitest";
import {
  documentAnchorBlockId,
  documentBlockText,
  formatId,
  parseDocumentMarkdown,
  parseId,
  tokenizeLinks,
} from "../src/index.js";

describe("parseDocumentMarkdown (#222)", () => {
  it("assigns paragraph block IDs in document order, headings included", () => {
    const doc = parseDocumentMarkdown("# Title\n\nFirst para.\n\n## Part\n\nSecond para.\n\n- one\n- two\n");
    expect(doc.title).toBe("Title");
    expect(doc.blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["heading", "content", "heading", "content", "content"]);
    expect(documentBlockText(doc.blocks[1])).toContain("First para.");
    expect(documentBlockText(doc.blocks[4])).toContain("one");
    // Inner block ids match the document block ids (anchor + citation identity).
    for (const b of doc.blocks) expect(b.block.id).toBe(b.id);
  });

  it("keeps code fences whole and does not split headings inside them", () => {
    const doc = parseDocumentMarkdown("Intro.\n\n```\n# not a heading\ncode\n```\n\nAfter.\n");
    expect(doc.blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);
    expect(doc.blocks[1].block.type).toBe("code");
  });

  it("falls back to the first text for the title", () => {
    expect(parseDocumentMarkdown("Just a paragraph.").title).toBe("Just a paragraph.");
    expect(parseDocumentMarkdown("").title).toBe("Untitled document");
    expect(parseDocumentMarkdown("").blocks).toEqual([]);
  });
});

describe("doc: IDs (#222)", () => {
  it("parse and format round-trip", () => {
    expect(parseId("doc:p3")).toEqual({ kind: "doc", blockId: "p3" });
    expect(formatId({ kind: "doc", blockId: "p3" })).toBe("doc:p3");
    expect(parseId("doc:xyz")).toBeNull();
    expect(documentAnchorBlockId("p3")).toBe("document#p3");
  });

  it("tokenizes as a link token", () => {
    const toks = tokenizeLinks("see [[doc:p2]] and [[doc:p9|the part]]");
    expect(toks.map((t) => t.idText)).toEqual(["doc:p2", "doc:p9"]);
  });
});
