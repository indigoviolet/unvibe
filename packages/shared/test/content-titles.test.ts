/**
 * Card title fallback (issue #49) and echo stripping (issue #50).
 */
import { describe, expect, it } from "vitest";
import type { Block } from "../src/entities.js";
import { parseCards } from "../src/content/parse.js";
import {
  CARD_TITLE_FALLBACK_MAX,
  displayCardTitle,
  fallbackCardTitle,
  normalizeEchoLine,
  stripLeadingEcho,
} from "../src/content/titles.js";

function para(standard: string, citations: string[] = []): Block {
  return {
    type: "paragraph",
    id: "b1",
    text: { standard },
    citations: citations.map((target) => ({ target })),
  };
}

describe("fallbackCardTitle (issue #49)", () => {
  it("returns short bodies whole", () => {
    expect(fallbackCardTitle([para("Body of u.")])).toBe("Body of u.");
  });

  it("cuts long bodies on a word boundary with an ellipsis, never mid-word", () => {
    const body =
      "A single microphone cannot tell who is speaking because the childrens voices all sound the same in this recording";
    const title = fallbackCardTitle([para(body)]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(CARD_TITLE_FALLBACK_MAX + 1);
    // Word boundary: the next source character after the cut is a space.
    const stem = title.slice(0, -1);
    expect(body.startsWith(stem)).toBe(true);
    expect(body[stem.length]).toBe(" ");
  });

  it("prefers the first sentence when it fits", () => {
    const body =
      "Not with this PR. The fast path checks for CRLF and the pattern requires CRLF too, so bare line endings pass through unchanged.";
    expect(fallbackCardTitle([para(body)])).toBe("Not with this PR.");
  });

  it("does not end the title at an abbreviation", () => {
    const body =
      "Use e.g. folds here for the demonstration case at hand today. The rest of this paragraph carries on past the limit.";
    expect(fallbackCardTitle([para(body)])).toBe("Use e.g. folds here for the demonstration case at hand today.");
  });

  it("falls back to a word cut when the first sentence is too long", () => {
    const body =
      "HTTP/1.1 originally let a server continue a header value on the next line, as long as that line started with a space or tab.";
    const title = fallbackCardTitle([para(body)]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(CARD_TITLE_FALLBACK_MAX + 1);
  });

  it("returns empty for cards with no text", () => {
    expect(fallbackCardTitle([])).toBe("");
  });

  it("displayCardTitle keeps a real title and falls back otherwise", () => {
    const blocks = [para("Body of u.")];
    expect(displayCardTitle("The problem", blocks)).toBe("The problem");
    expect(displayCardTitle(null, blocks)).toBe("Body of u.");
    expect(displayCardTitle("  ", blocks)).toBe("Body of u.");
  });
});

describe("normalizeEchoLine (issue #50)", () => {
  it("ignores case, whitespace, quotes and trailing punctuation", () => {
    expect(normalizeEchoLine(`  "Within   the margin!" `)).toBe("within the margin");
    expect(normalizeEchoLine("within the margin")).toBe("within the margin");
  });
});

describe("stripLeadingEcho (issue #50)", () => {
  it("drops a leading line exactly echoing the selection", () => {
    const blocks = [para("within the margin"), para("It means the levels agree.")];
    const stripped = stripLeadingEcho(blocks, ["within the margin"]);
    expect(stripped).toHaveLength(1);
    expect(stripped[0].type).toBe("paragraph");
    if (stripped[0].type !== "paragraph") return;
    expect(stripped[0].text.standard).toBe("It means the levels agree.");
  });

  it("drops echo variants (case, quotes, punctuation)", () => {
    const blocks = [para("<em>“Within the margin.”</em>"), para("Answer.")];
    expect(stripLeadingEcho(blocks, ["within the margin"])).toHaveLength(1);
  });

  it("keeps a leading line that merely starts with the selection", () => {
    const blocks = [para("within the margin means the levels agree.")];
    expect(stripLeadingEcho(blocks, ["within the margin"])).toHaveLength(1);
  });

  it("keeps an echo line that carries citations (it holds more)", () => {
    const blocks = [para("within the margin", ["diff:conn:82"]), para("Answer.")];
    expect(stripLeadingEcho(blocks, ["within the margin"])).toHaveLength(2);
  });

  it("keeps a non-leading echo", () => {
    const blocks = [para("Answer first."), para("within the margin")];
    expect(stripLeadingEcho(blocks, ["within the margin"])).toHaveLength(2);
  });

  it("does nothing without candidates", () => {
    const blocks = [para("within the margin")];
    expect(stripLeadingEcho(blocks, [])).toHaveLength(1);
    expect(stripLeadingEcho(blocks, [null, undefined, "  "])).toHaveLength(1);
  });
});

describe("stripEchoFromCards via parseCards", () => {
  const reply = (first: string): string => `${first}\n\nThe actual answer follows.\n`;

  it("strips a title echo without opts opt-out, keeps it by default", () => {
    const body = `## The problem\n\nThe problem\n\nThe actual answer follows.\n`;
    expect(parseCards(body)).toHaveLength(1);
    expect(parseCards(body)[0].blocks).toHaveLength(2);
    const stripped = parseCards(body, { echoCandidates: [] });
    expect(stripped[0].blocks).toHaveLength(1);
  });

  it("strips selection and question echoes", () => {
    const cards = parseCards(reply("within the margin"), {
      echoCandidates: ["within the margin", "What does it mean?"],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].blocks).toHaveLength(1);
  });

  it("leaves non-echo replies alone", () => {
    const cards = parseCards(reply("A fresh opening line."), { echoCandidates: ["within the margin"] });
    expect(cards[0].blocks).toHaveLength(2);
  });
});

describe("#49 and #50 do not fight", () => {
  it("an untitled reply keeps its first sentence and gains it as fallback", () => {
    const body = "Hello world. More detail follows in this paragraph here, well past the length limit.\n";
    const cards = parseCards(body, { echoCandidates: [] });
    expect(cards[0].title).toBeNull();
    expect(cards[0].blocks).toHaveLength(1);
    // The fallback must not cause the strip to delete anything.
    expect(fallbackCardTitle(cards[0].blocks)).toBe("Hello world.");
    expect(displayCardTitle(cards[0].title, cards[0].blocks)).toBe("Hello world.");
  });

  it("a title echo is dropped and the fallback comes from the next line", () => {
    const body = "## The problem\n\nThe problem\n\nOld servers split headers across lines here.\n";
    const cards = parseCards(body, { echoCandidates: [] });
    expect(cards[0].title).toBe("The problem");
    expect(cards[0].blocks).toHaveLength(1);
  });
});
