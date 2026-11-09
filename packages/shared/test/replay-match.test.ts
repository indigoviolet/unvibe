/**
 * Unit tests for the shared replay matcher (issue #334): the one matching
 * implementation the service replay runner and the static demo both use.
 * The service's replay tests still cover the runner end to end; these pin
 * the pure matching contract the demo depends on.
 */
import { describe, expect, it } from "vitest";
import {
  chunkReplayText,
  explicitReplayMarker,
  extractReplayKey,
  guessReplayKind,
  replayPlaceholderText,
  replayUsageFor,
  resolveRecording,
  type ReplayManifestEntry,
} from "../src/replay-match.js";

const ENTRIES: ReplayManifestEntry[] = [
  { kind: "reader", file: "reader.md" },
  { kind: "hunk", key: "conn:0", file: "hunk-conn-0.md" },
  { kind: "hunk", key: "log:0", file: "hunk-log-0.md" },
  {
    kind: "explain",
    key: "obs-fold",
    pattern: "obs-fold|fold|unfold|continuation|line folding",
    file: "explain-obs-fold.md",
  },
  {
    kind: "ask",
    key: "order",
    pattern: "order|ordering|duplicate",
    file: "ask-order.md",
  },
  { kind: "diagram", key: "fold", file: "diagram-fold.md" },
];

const hasAll = (file: string): boolean => ENTRIES.some((e) => e.file === file);

describe("guessReplayKind", () => {
  it("prefers ask over explain when both words appear (#136)", () => {
    expect(guessReplayKind("Ask about this explain text")).toBe("ask");
  });

  it("matches hunk by keyword", () => {
    expect(guessReplayKind("summarize this hunk")).toBe("hunk");
  });

  it("matches the update pass by its title before critic/hunk words (#351)", () => {
    expect(guessReplayKind("# Update pass\n\nThe critic's rules apply to these hunks.")).toBe("update-pass");
  });

  it("returns null for unrecognized prompts", () => {
    expect(guessReplayKind("Tell me about quantum llamas.")).toBeNull();
  });
});

describe("explicitReplayMarker", () => {
  it("parses kind and key markers", () => {
    expect(explicitReplayMarker("replay-kind: hunk\nreplay-key: conn:0")).toEqual({
      kind: "hunk",
      key: "conn:0",
    });
  });

  it("parses a kind-only marker", () => {
    expect(explicitReplayMarker("replay-kind: explain")).toEqual({ kind: "explain", key: null });
  });

  it("returns null without a marker", () => {
    expect(explicitReplayMarker("plain prompt")).toBeNull();
  });
});

describe("resolveRecording", () => {
  it("matches explain prompts by quoted text like the prototype KB regexes", () => {
    expect(
      resolveRecording(ENTRIES, hasAll, "Explain this: quote: what is obs-fold line folding?"),
    ).toMatchObject({ kind: "explain", file: "explain-obs-fold.md", placeholder: false });
  });

  it("matches ask prompts by question text like the prototype ASK regexes", () => {
    expect(
      resolveRecording(ENTRIES, hasAll, "Ask: does order of duplicate headers survive?"),
    ).toMatchObject({ kind: "ask", key: "order", placeholder: false });
  });

  it("honours explicit kind/key markers exactly", () => {
    expect(resolveRecording(ENTRIES, hasAll, "replay-kind: hunk\nreplay-key: conn:0")).toMatchObject({
      file: "hunk-conn-0.md",
      placeholder: false,
    });
  });

  it("keeps pattern matching under a kind-only explain/ask marker", () => {
    expect(
      resolveRecording(ENTRIES, hasAll, "replay-kind: ask\nAsk: does order survive?"),
    ).toMatchObject({ kind: "ask", key: "order", placeholder: false });
  });

  it("extracts keyed kinds from keyword hints", () => {
    expect(resolveRecording(ENTRIES, hasAll, "replay-kind: diagram\nreplay-key: fold")).toMatchObject({
      file: "diagram-fold.md",
      placeholder: false,
    });
    expect(resolveRecording(ENTRIES, hasAll, "diagram of the fold path")).toMatchObject({
      kind: "diagram",
      key: "fold",
      placeholder: false,
    });
  });

  it("serves a labelled placeholder when nothing matches", () => {
    const resolved = resolveRecording(ENTRIES, hasAll, "Tell me about quantum llamas.");
    expect(resolved.placeholder).toBe(true);
    expect(replayPlaceholderText(resolved, "Tell me about quantum llamas.")).toMatch(/\[replay placeholder/);
  });

  it("serves a placeholder when the entry's text is missing", () => {
    const resolved = resolveRecording(ENTRIES, () => false, "replay-kind: hunk\nreplay-key: conn:0");
    expect(resolved).toMatchObject({ kind: "hunk", key: "conn:0", file: null, placeholder: true });
  });
});

describe("issue #365: minimal-turn matching", () => {
  // Entries mirror the real fixture's overlapping shapes: the base and
  // `thread-` variants share a pattern, and quote-only first turns
  // match through short-quote alternatives.
  const ENTRIES365: ReplayManifestEntry[] = [
    { kind: "ask", key: "bare-lf", pattern: "that case is also untested|Should a bare LF not followed by whitesp", file: "ask-bare-lf.md" },
    { kind: "ask", key: "identity", pattern: "it deletes and re-adds the headers on th|Is the rewritten message the same object|Does the fast path still catch a fold", file: "ask-identity.md" },
    { kind: "ask", key: "thread-barelf", pattern: "that case is also untested|Should a bare LF not followed by whitesp", file: "ask-thread-barelf.md" },
    { kind: "ask", key: "two-spaces", pattern: "which collapse to two spaces|Is the double space here intend", file: "ask-two-spaces.md" },
    { kind: "explain", key: "ows", pattern: "matches optional whitespace, then CRLF, then req|optional whitespace", file: "explain-ows.md" },
    { kind: "explain", key: "obsfold", pattern: "keeps those raw CRLFs inside the HTTPMessage val", file: "explain-obsfold.md" },
  ];
  const has365 = (file: string): boolean => ENTRIES365.some((e) => e.file === file);

  const plainFollowup = (message: string): string =>
    [
      "# Ask follow-up",
      "",
      "## Following",
      "",
      "This is turn [[ann:ann_x#r2]] in thread [[ann:ann_x]], following the turns above. The session already holds the selection, the item and the earlier turns — answer only what is new.",
      "",
      "## Changed hunks since this turn's version",
      "",
      "(no changes)",
      "",
      "## The follow-up question",
      "",
      message,
      "",
      "<!-- replay-kind: ask -->",
    ].join("\n");

  const chipFollowup = (quote: string, itemId: string, message: string): string =>
    [
      "# Ask follow-up",
      "",
      "## Following",
      "",
      `New selection in reply [[${itemId}]]:`,
      "",
      `> ${quote}`,
      "",
      `Item: ${itemId}`,
      "Selection offsets: 0–10",
      "",
      "Answer as turn [[ann:ann_x#r2]] in thread [[ann:ann_x]].",
      "",
      "## Changed hunks since this turn's version",
      "",
      "(no changes)",
      "",
      "## The follow-up question",
      "",
      message,
      "",
      "<!-- replay-kind: ask -->",
    ].join("\n");

  const firstTurn = (kind: "ask" | "explain", quote: string, itemId: string, message: string): string =>
    [
      kind === "ask" ? "# Ask" : "# Explain",
      "",
      "## Selected text",
      "",
      `> ${quote}`,
      "",
      "## Item (fetch it with `get_item` when you need more than the quote)",
      "",
      itemId,
      "",
      "## Selection offsets",
      "",
      "108–135",
      "",
      "## Conversation so far",
      "",
      "(none)",
      "",
      "## Changed hunks since this turn's version",
      "",
      "(no changes)",
      "",
      kind === "ask" ? "## The question" : "## The default question",
      "",
      message,
      "",
      `<!-- replay-kind: ${kind} -->`,
    ].join("\n");

  it("matches a plain follow-up by its message", () => {
    expect(
      resolveRecording(ENTRIES365, has365, plainFollowup("Is the rewritten message the same object downstream code already holds, or a copy?")),
    ).toMatchObject({ kind: "ask", key: "identity", file: "ask-identity.md", placeholder: false });
  });

  it("prefers the thread-scoped recording when the quote is absent", () => {
    // The message matches both the base and the thread- variant; the
    // thread/reply context in the follow-up block picks thread-barelf.
    expect(
      resolveRecording(ENTRIES365, has365, plainFollowup("Should a bare LF not followed by whitespace also be normalized, or is leaving it correct?")),
    ).toMatchObject({ kind: "ask", key: "thread-barelf", file: "ask-thread-barelf.md", placeholder: false });
  });

  it("keeps first-match order without thread context", () => {
    const bare = plainFollowup("Should a bare LF not followed by whitespace also be normalized?")
      .replaceAll("ann:ann_x#r2", "ann:ann_x")
      .replace(" in thread [[ann:ann_x]]", "");
    expect(resolveRecording(ENTRIES365, has365, bare)).toMatchObject({ key: "bare-lf", file: "ask-bare-lf.md" });
  });

  it("matches a chip follow-up by its quote", () => {
    expect(
      resolveRecording(ENTRIES365, has365, chipFollowup("Is the double space here intended?", "ann:ann_x#r1", "What about this spot?")),
    ).toMatchObject({ kind: "ask", key: "two-spaces", file: "ask-two-spaces.md", placeholder: false });
  });

  it("a chip quote does not trigger the thread preference", () => {
    // Quote and thread context are both present; the message matches the
    // base/thread pair, so normal first-match order applies.
    expect(
      resolveRecording(ENTRIES365, has365, chipFollowup("matches optional whitespace", "ann:ann_x#r1", "Should a bare LF not followed by whitespace also be normalized?")),
    ).toMatchObject({ key: "bare-lf", file: "ask-bare-lf.md" });
  });

  it("matches first turns by quote and question", () => {
    expect(
      resolveRecording(ENTRIES365, has365, firstTurn("ask", "matches optional whitespace", "card:decisions#b4", "Does the fast path still catch a fold that uses a bare LF?")),
    ).toMatchObject({ kind: "ask", key: "identity", file: "ask-identity.md", placeholder: false });
    expect(
      resolveRecording(ENTRIES365, has365, firstTurn("explain", "optional whitespace", "card:central#b1", "Explain this.")),
    ).toMatchObject({ kind: "explain", key: "ows", file: "explain-ows.md", placeholder: false });
  });

  it("falls back to the kind's first entry when nothing matches", () => {
    expect(
      resolveRecording(ENTRIES365, has365, plainFollowup("What color is a ripe banana?")),
    ).toMatchObject({ kind: "ask", key: "bare-lf", file: "ask-bare-lf.md", placeholder: false });
  });
});

describe("extractReplayKey", () => {
  it("parses hunk file keys", () => {
    expect(extractReplayKey("hunk", "summarize conn:1 please")).toBe("conn:1");
    expect(extractReplayKey("hunk", "no key here")).toBeNull();
  });

  it("parses depth card/level pairs", () => {
    expect(extractReplayKey("depth", "deeper on the central card")).toBe("central:deep");
  });
});

describe("chunk + usage helpers", () => {
  it("chunks on word boundaries", () => {
    expect(chunkReplayText("ab cd ef", 4)).toEqual(["ab ", "cd ", "ef"]);
    expect(chunkReplayText("", 64)).toEqual([]);
  });

  it("derives deterministic token counts", () => {
    expect(replayUsageFor(400, 200)).toMatchObject({ inputTokens: 100, outputTokens: 50 });
  });
});
