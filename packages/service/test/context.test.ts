import { describe, expect, it } from "vitest";
import {
  appendLogEntry,
  baseKey,
  batchLogEntries,
  buildBasePack,
  buildL1Source,
  buildL4Conversation,
  buildSecondOpinionContext,
  decideRebuild,
  defaultThresholds,
  filterChangeList,
  formatChangeList,
  formatLogBatch,
  NEVER_LOGGED_KINDS,
  formatLogEntry,
  payloadText,
  shouldEnterLog,
  stableStringify,
  charTokenEstimator,
  type PromptReviewSnapshot,
} from "../src/context/index.js";
import { renderTemplate, loadTemplatesDirSync } from "../src/prompts/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSnapshot } from "./fixtures.js";

const REPO_PROMPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "prompts",
);

/** Same logical snapshot, rebuilt with a different key insertion order. */
function shuffledSnapshot(): PromptReviewSnapshot {
  const s = fixtureSnapshot();
  const json = JSON.stringify(s);
  const parsed = JSON.parse(json) as PromptReviewSnapshot;
  // Rebuild top-level in a different order; arrays keep their order.
  return {
    model: parsed.model,
    log: parsed.log,
    concepts: parsed.concepts,
    findings: parsed.findings,
    cards: parsed.cards,
    pinnedCode: parsed.pinnedCode,
    files: parsed.files,
    commitLog: parsed.commitLog,
    description: parsed.description,
    sourceKind: parsed.sourceKind,
    guideRevision: parsed.guideRevision,
    baseRef: parsed.baseRef,
    headSha: parsed.headSha,
    version: parsed.version,
    branch: parsed.branch,
    prNumber: parsed.prNumber,
    repo: parsed.repo,
    title: parsed.title,
    reviewId: parsed.reviewId,
  };
}

describe("base pack", () => {
  it("is byte-identical for identical inputs, twice and with shuffled key order", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const instructionsTpl = lib.get("instructions");
    if (!instructionsTpl) throw new Error("missing instructions template");
    const instructions = renderTemplate(instructionsTpl, { access_policy: "policy (test)" });
    const a = buildBasePack(fixtureSnapshot(), instructions);
    const b = buildBasePack(fixtureSnapshot(), instructions);
    const c = buildBasePack(shuffledSnapshot(), instructions);
    expect(a.user).toBe(b.user);
    expect(a.user).toBe(c.user);
    expect(a.key).toBe("1/g1/main-model");
    expect(a.key).toBe(baseKey(fixtureSnapshot()));
    expect(a.tokens).toBeGreaterThan(0);
  });

  it("renders hunk IDs on headers and line numbers on lines", () => {
    const l1 = buildL1Source(fixtureSnapshot());
    expect(l1.overBudget).toBe(false);
    expect(l1.text).toContain("[[h:conn:h111]]");
    expect(l1.text).toContain("n651 + headers = HTTPHeaderDict(_normalize_header_values(msg))");
    expect(l1.text).toContain("o641 - headers = HTTPHeaderDict(msg.items())");
    expect(l1.text).toContain("## Hidden hunks");
    expect(l1.text).toContain("[[h:conn:h222]]");
    expect(l1.inlinedHunkIds).toHaveLength(3);
  });

  it("falls back over budget: headers plus summaries and pinned hunks, with a get_hunk notice", () => {
    const snap = fixtureSnapshot();
    const l1 = buildL1Source(snap, { inlineBudgetTokens: 50, pinnedHunkHashes: new Set(["h333"]) });
    expect(l1.overBudget).toBe(true);
    expect(l1.text).toContain("get_hunk");
    // Cited hunk stays in full…
    expect(l1.text).toContain("n651 + headers = HTTPHeaderDict(_normalize_header_values(msg))");
    // …pinned hunk stays in full…
    expect(l1.text).toContain("assert unfold(value) == b'before after'");
    // …the plain hidden hunk falls back to header + summary.
    expect(l1.text).toContain("[[h:conn:h222]]");
    expect(l1.text).not.toContain("from .util import _normalize_header_values");
    expect(l1.inlinedHunkIds).toEqual(["h:conn:h111", "h:tconn:h333"]);
    expect(l1.summarizedHunkIds).toEqual(["h:conn:h222"]);
  });

  it("L4 keeps a stable shape with empty parts", () => {
    const l4 = buildL4Conversation({
      anchorQuote: "fold?",
      anchorBlock: "",
      cardText: "",
      nearbyAnnotations: "",
      threadText: "",
      changeListText: formatChangeList([]),
      userMessage: "Why?",
    });
    expect(l4).toContain("## Anchor");
    expect(l4).toContain("(none)");
    expect(l4).toContain("(no changes)");
    expect(l4).toBe(buildL4Conversation({
      anchorQuote: "fold?",
      anchorBlock: "",
      cardText: "",
      nearbyAnnotations: "",
      threadText: "",
      changeListText: formatChangeList([]),
      userMessage: "Why?",
    }));
  });
});

describe("log and change lists (PRD §9.3)", () => {
  it("never logs UI state; card-local kinds need a card scope", () => {
    for (const kind of ["read", "collapse", "depth", "open", "close", "mark-for-pr"]) {
      expect(NEVER_LOGGED_KINDS.has(kind)).toBe(true);
      expect(shouldEnterLog(kind, { scope: "global" })).toBe(false);
    }
    expect(shouldEnterLog("example", { scope: "global" })).toBe(false);
    expect(shouldEnterLog("example", { scope: "card", cardId: "c-problem" })).toBe(true);
    expect(shouldEnterLog("thread-summary", { scope: "global" })).toBe(true);
    expect(shouldEnterLog("new-finding", { scope: "global" })).toBe(true);
  });

  it("appends with rising seq and batches by token budget", () => {
    const log = appendLogEntry([], "thread-summary", { summary: "one" }, { scope: "global" });
    const log2 = appendLogEntry(log, "thread-summary", { summary: "two" }, { scope: "global" });
    expect(log2.map((e) => e.seq)).toEqual([1, 2]);
    const one = batchLogEntries(log2, { batchTokens: 10_000 });
    expect(one).toHaveLength(1);
    // A tiny budget splits every entry into its own batch; none are lost.
    const split = batchLogEntries(log2, { batchTokens: 1 });
    expect(split).toHaveLength(2);
    expect(split.flat().map((e) => e.seq)).toEqual([1, 2]);
    expect(formatLogBatch(log2)).toContain("seq 1–2");
  });

  it("stableStringify orders keys; payloadText prefers summary fields", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":1}');
    expect(payloadText({ summary: "hello\nworld" })).toBe("hello\nworld");
    expect(charTokenEstimator.estimateTokens("")).toBe(0);
    expect(charTokenEstimator.estimateTokens("abcd")).toBe(1);
    expect(charTokenEstimator.estimateTokens("abcde")).toBe(2);
  });

  it("formatLogEntry never cuts text: full kinds keep lines, others fold to one", () => {
    const long = `${"word ".repeat(80)}end.`;
    const global = { scope: "global" } as const;
    // One-line kinds fold whitespace but keep every word.
    expect(formatLogEntry({ seq: 1, kind: "thread-summary", payload: { summary: `a\n${long}` }, scope: global })).toBe(
      `- [1 thread-summary global] a ${long}`,
    );
    // Full kinds keep their line breaks, indented under the list item.
    expect(
      formatLogEntry({ seq: 2, kind: "new-card", payload: { summary: `Explain "q":\n\n${long}` }, scope: global }),
    ).toBe(`- [2 new-card global] Explain "q":\n\n  ${long}`);
    // Contributions read as text, not JSON: id, then one sub-item per item.
    const contribution = formatLogEntry({
      seq: 3,
      kind: "contribution",
      payload: {
        contributionId: "ct_1",
        sourceSession: "s1",
        items: [
          { kind: "fact", text: long },
          { kind: "open_question", text: "Why?\nSecond line." },
        ],
      },
      scope: global,
    });
    expect(contribution).toBe(
      `- [3 contribution global] ct_1\n  - fact: ${long}\n  - open_question: Why?\n    Second line.`,
    );
    expect(contribution).not.toContain("…");
  });

  it("filters change lists: global plus local for the session's card or hunk", () => {
    const snap = fixtureSnapshot();
    // Session anchored on c-problem, seen through seq 1: global 4,5,6 + local 2.
    const forCard = filterChangeList(snap.log, { lastSeenSeq: 1, cardId: "c-problem" });
    expect(forCard.map((e) => e.seq)).toEqual([2, 4, 5, 6]);
    // Another card's local entry is excluded.
    const other = filterChangeList(snap.log, { lastSeenSeq: 1, cardId: "c-central" });
    expect(other.map((e) => e.seq)).toEqual([3, 4, 5, 6]);
    // A hunk session matches payload.hunkHash (plus globals after lastSeen).
    const hunk = filterChangeList(snap.log, { lastSeenSeq: 4, hunkHash: "h111" });
    expect(hunk.map((e) => e.seq)).toEqual([5, 6]);
    // Up to date: nothing.
    expect(filterChangeList(snap.log, { lastSeenSeq: 6, cardId: "c-problem" })).toEqual([]);
    expect(formatChangeList([])).toBe("(no changes)");
  });
});

describe("rebuild decisions (PRD §9.4)", () => {
  const base = {
    baseVersion: 1,
    baseGuideRevision: "g1",
    baseTokens: 10_000,
    appendedTokens: 0,
    supersededTokens: 0,
    cacheExpired: false,
    currentVersion: 1,
    currentGuideRevision: "g1",
  };
  const thresholds = defaultThresholds({ rebuildSupersededRatio: 0.2, rebuildAppendedTokens: 10_000 });

  it("stays cold when nothing changed; fires per trigger", () => {
    expect(decideRebuild(base, thresholds)).toEqual({ rebuild: false, reasons: [] });
    expect(decideRebuild({ ...base, currentVersion: 2 }, thresholds).reasons).toEqual(["new-version"]);
    expect(decideRebuild({ ...base, currentGuideRevision: "g2" }, thresholds).reasons).toEqual([
      "guide-regenerated",
    ]);
    expect(decideRebuild({ ...base, cacheExpired: true }, thresholds).reasons).toEqual(["cache-expired"]);
  });

  it("uses strict greater-than on the size thresholds", () => {
    expect(decideRebuild({ ...base, supersededTokens: 2000 }, thresholds).rebuild).toBe(false);
    expect(decideRebuild({ ...base, supersededTokens: 2001 }, thresholds).reasons).toEqual([
      "superseded-ratio",
    ]);
    expect(decideRebuild({ ...base, appendedTokens: 10_000 }, thresholds).rebuild).toBe(false);
    expect(decideRebuild({ ...base, appendedTokens: 10_001 }, thresholds).reasons).toEqual([
      "appended-tokens",
    ]);
  });
});

describe("second-opinion isolation (PRD §12)", () => {
  it("includes only cited code: guide, findings, contributions and uncited pins cannot leak", () => {
    const guideProbe = "GUIDE-PROBE- Central change prose must not leak";
    const findingProbe = "FINDING-PROBE linear-time claim has no test";
    const contributionProbe = "CONTRIBUTION-PROBE Requests reads the original message";
    const uncitedProbe = "UNCITED-PIN-PROBE secret helper body";
    const ctx = buildSecondOpinionContext({
      instructions: "L0 instructions",
      sourceText: "L1 source",
      codeExcerpts: [
        { id: "code:a.py:1-2@s", text: "CITED-CODE-PROBE normalized = True" },
        { id: "code:b.py:9-9@s", text: uncitedProbe },
      ],
      citedIds: ["code:a.py:1-2@s", "code:missing.py:1-1@s", "code:a.py:1-2@s"],
    });
    expect(ctx.includedIds).toEqual(["code:a.py:1-2@s"]);
    expect(ctx.missingIds).toEqual(["code:missing.py:1-1@s"]);
    expect(ctx.text).toContain("CITED-CODE-PROBE");
    for (const probe of [guideProbe, findingProbe, contributionProbe, uncitedProbe]) {
      expect(ctx.text, probe).not.toContain(probe);
    }
    // Deterministic: excerpts render in citedIds order.
    expect(ctx.text).toBe(buildSecondOpinionContext({
      instructions: "L0 instructions",
      sourceText: "L1 source",
      codeExcerpts: [
        { id: "code:b.py:9-9@s", text: uncitedProbe },
        { id: "code:a.py:1-2@s", text: "CITED-CODE-PROBE normalized = True" },
      ],
      citedIds: ["code:a.py:1-2@s", "code:missing.py:1-1@s", "code:a.py:1-2@s"],
    }).text);
  });
});
