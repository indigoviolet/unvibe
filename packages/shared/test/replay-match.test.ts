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
