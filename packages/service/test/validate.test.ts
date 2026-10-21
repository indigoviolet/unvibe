import { describe, expect, it } from "vitest";
import { parseBlocks } from "@unvibe/shared";
import type { ReviewLookup } from "../src/validate/lookup.js";
import { REPAIR_THRESHOLD, validateReply, validateTarget } from "../src/validate/validate.js";

function stubLookup(overrides: Partial<ReviewLookup> = {}): ReviewLookup {
  return {
    resolveFileKey: (key) => (key === "conn" ? "conn" : null),
    hunkAtLine: (fileKey, line) => {
      if (fileKey !== "conn") return null;
      if (line >= 80 && line <= 88) return { hash: "h1", start: 80, end: 88 };
      if (line >= 91 && line <= 110) return { hash: "h2", start: 91, end: 110 };
      return null;
    },
    hunkRange: (fileKey, hash) => {
      if (fileKey === "conn" && hash === "h1") return { start: 80, end: 88 };
      return null;
    },
    fileExists: (p) => p === "src/a.py",
    descParagraph: (id) => (id === "d-intro" ? "intro text" : null),
    pageExists: (id) => id === "f-lf",
    cardExists: (id) => id === "central",
    blockExists: (cardId, blockId) => cardId === "central" && blockId === "b1",
    conceptKnown: (slug) => slug === "obs-fold",
    annotationExists: (id) => id === "t1",
    hostText: (host) => (host === "card:central#b1" ? "the quick brown fox" : null),
    mapId: (id) => (id === "page:old" ? "page:f-lf" : null),
    ...overrides,
  };
}

describe("validateTarget", () => {
  const lookup = stubLookup();

  it("accepts a diff range inside one hunk", () => {
    expect(validateTarget("diff:conn:80-82", lookup).status).toBe("valid");
  });

  it("repairs a range spilling past the hunk end", () => {
    const r = validateTarget("diff:conn:86-90", lookup);
    expect(r.status).toBe("repaired");
    expect(r.repairedTo).toBe("diff:conn:86-88");
  });

  it("rejects a range spanning two hunks", () => {
    const r = validateTarget("diff:conn:85-95", lookup);
    expect(r.status).toBe("unverified");
    expect(r.reason).toMatch(/more than one hunk/);
  });

  it("rejects lines outside any hunk", () => {
    const r = validateTarget("diff:conn:200-210", lookup);
    expect(r.status).toBe("unverified");
  });

  it("rejects unknown files", () => {
    expect(validateTarget("diff:nope:1", lookup).status).toBe("unverified");
  });

  it("remaps IDs from an older version", () => {
    const r = validateTarget("page:old", lookup);
    expect(r).toMatchObject({ status: "repaired", repairedTo: "page:f-lf" });
  });

  it("accepts code in an existing file at any range, rejects missing files (#81)", () => {
    expect(validateTarget("code:src/a.py:10-20", lookup).status).toBe("valid");
    // No length check: a range past the end still validates; the file
    // tab highlights whatever part of it exists.
    expect(validateTarget("code:src/a.py:10-99", lookup).status).toBe("valid");
    expect(validateTarget("code:src/a.py:999", lookup).status).toBe("valid");
    expect(validateTarget("code:src/missing.py:1", lookup).status).toBe("unverified");
  });

  it("checks desc paragraphs", () => {
    expect(validateTarget("desc:d-intro", lookup).status).toBe("valid");
    expect(validateTarget("desc:nope", lookup).status).toBe("unverified");
  });

  it("checks cards and blocks", () => {
    expect(validateTarget("card:central#b1", lookup).status).toBe("valid");
    expect(validateTarget("card:nope", lookup).status).toBe("unverified");
    expect(validateTarget("card:central#b9", lookup).status).toBe("unverified");
  });

  it("turns unknown concepts into open-on-click links, not failures", () => {
    expect(validateTarget("concept:obs-fold", lookup)).toMatchObject({ status: "valid" });
    const r = validateTarget("concept:brand-new", lookup);
    expect(r).toMatchObject({ status: "valid", candidate: true });
  });

  it("checks pages, annotations and hunks", () => {
    expect(validateTarget("page:f-lf", lookup).status).toBe("valid");
    expect(validateTarget("page:nope", lookup).status).toBe("unverified");
    expect(validateTarget("ann:t1", lookup).status).toBe("valid");
    expect(validateTarget("ann:nope", lookup).status).toBe("unverified");
    expect(validateTarget("h:conn:h1", lookup).status).toBe("valid");
    expect(validateTarget("h:conn:nope", lookup).status).toBe("unverified");
  });

  it("flags unparseable IDs as unverified", () => {
    const r = validateTarget("bogus:1", lookup);
    expect(r.status).toBe("unverified");
    expect(r.reason).toMatch(/not a known ID/);
  });
});

describe("validateReply", () => {
  const lookup = stubLookup();

  it("validates every token once and reports no repair turn for one failure", () => {
    const blocks = parseBlocks(
      "A [[diff:conn:80-82]] and [[concept:obs-fold|x]] plus [[diff:conn:200]].\n",
    );
    const report = validateReply(blocks, lookup);
    // Citations first, then inline links (first-seen order per group).
    expect(report.tokens.map((t) => t.status)).toEqual(["valid", "unverified", "valid"]);
    expect(report.unverified).toBe(1);
    expect(report.needsRepairTurn).toBe(false);
  });

  it(`asks for one repair turn at ${REPAIR_THRESHOLD} failures`, () => {
    const blocks = parseBlocks("Bad [[diff:conn:200]] and [[page:nope]].\n");
    const report = validateReply(blocks, lookup);
    expect(report.unverified).toBe(2);
    expect(report.needsRepairTurn).toBe(true);
  });

  it("lists unknown concept slugs as not-yet-written pages", () => {
    const blocks = parseBlocks("New [[concept:fresh|Fresh]].\n");
    const report = validateReply(blocks, lookup);
    expect(report.candidates).toEqual(["concept:fresh"]);
  });

  it("checks quoted anchors against host text", () => {
    const blocks = parseBlocks("Plain.\n");
    const ok = validateReply(blocks, lookup, {
      anchor: { quote: "quick brown", host: "card:central#b1" },
    });
    expect(ok.anchor).toMatchObject({ ok: true });
    const bad = validateReply(blocks, lookup, {
      anchor: { quote: "missing words", host: "card:central#b1" },
    });
    expect(bad.anchor).toMatchObject({ ok: false });
    const unknown = validateReply(blocks, lookup, {
      anchor: { quote: "x", host: "card:nope#b1" },
    });
    expect(unknown.anchor?.reason).toMatch(/unknown anchor host/);
  });

  it("rejects a card-only anchor host with a repair turn (#51)", () => {
    const blocks = parseBlocks("Plain.\n");
    const cardOnly = validateReply(blocks, lookup, {
      anchor: { quote: "quick brown", host: "card:central" },
    });
    expect(cardOnly.anchor).toMatchObject({ ok: false });
    expect(cardOnly.anchor?.reason).toMatch(/only the card/);
    expect(cardOnly.needsRepairTurn).toBe(true);
    // Other anchor failures stay informational: no repair turn.
    const mismatch = validateReply(blocks, lookup, {
      anchor: { quote: "missing words", host: "card:central#b1" },
    });
    expect(mismatch.anchor).toMatchObject({ ok: false });
    expect(mismatch.needsRepairTurn).toBe(false);
    // An empty quote is not an anchor at all.
    const empty = validateReply(blocks, lookup, { anchor: { quote: "  ", host: "card:central" } });
    expect(empty.anchor).toMatchObject({ ok: false });
    expect(empty.needsRepairTurn).toBe(false);
  });
});
