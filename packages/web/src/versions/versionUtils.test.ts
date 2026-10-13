/**
 * Pure-part tests (M8): layer splitting of expanded prompts, token /
 * cache-rate formatting, job list reduction from WS events.
 */
import { describe, expect, it } from "vitest";
import type { Job } from "@unvibe/shared";
import {
  formatCacheRate,
  formatRetryIn,
  formatTokens,
  pooledCacheRate,
  pooledTokens,
  reduceJobs,
  splitLayers,
  staleHeadline,
  versionCountsText,
} from "./versionUtils.js";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    kind: "ask",
    model: "m",
    priority: 10,
    state: "running",
    ...over,
  };
}

describe("formatTokens", () => {
  it("compacts thousands and millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(412)).toBe("412");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(42500)).toBe("42.5k");
    expect(formatTokens(250000)).toBe("250k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(NaN)).toBe("—");
  });
});

describe("formatCacheRate", () => {
  it("prints one decimal or a dash", () => {
    expect(formatCacheRate(0.915)).toBe("91.5%");
    expect(formatCacheRate(0)).toBe("0.0%");
    expect(formatCacheRate(undefined)).toBe("—");
    expect(formatCacheRate(NaN)).toBe("—");
  });
});

describe("pooled usage", () => {
  it("sums tokens and shows the read share as the hit rate", () => {
    const jobs = [
      job({ usage: { inputTokens: 40000, cachedReadTokens: 36000, cachedWriteTokens: 4000, outputTokens: 1000 } }),
      job({ id: "j2", usage: { inputTokens: 10000, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 500 } }),
      job({ id: "j3" }),
    ];
    expect(pooledTokens(jobs)).toEqual({ input: 50000, output: 1500, read: 36000, written: 4000 });
    expect(pooledCacheRate(jobs)).toBeCloseTo(0.4);
    expect(pooledCacheRate([job({ id: "j3" })])).toBeUndefined();
  });

  it("writes without reads show 0 % (#125)", () => {
    const jobs = [
      job({ usage: { inputTokens: 100, cachedReadTokens: 0, cachedWriteTokens: 900, outputTokens: 10 } }),
    ];
    expect(pooledCacheRate(jobs)).toBe(0);
  });
});

describe("formatRetryIn", () => {
  it("counts down in seconds then minutes", () => {
    expect(formatRetryIn(100_045, 100_000)).toBe("retry in 0s");
    expect(formatRetryIn(145_000, 100_000)).toBe("retry in 45s");
    expect(formatRetryIn(220_000, 100_000)).toBe("retry in 2m");
    expect(formatRetryIn(undefined)).toBe("—");
  });
});

describe("reduceJobs", () => {
  it("upserts on job events and ignores the rest", () => {
    const a = job({ id: "a" });
    const b = job({ id: "b", state: "queued" });
    expect(reduceJobs([a], { type: "job", job: b })).toEqual([a, b]);
    const b2 = { ...b, state: "running" as const };
    const next = reduceJobs([a, b], { type: "job", job: b2 });
    expect(next).toEqual([a, b2]);
    expect(reduceJobs([a], { type: "text", jobId: "a", delta: "hi" })).toEqual([a]);
    expect(reduceJobs([a], { type: "error", message: "x" })).toEqual([a]);
  });
});

describe("splitLayers", () => {
  const expanded = [
    "<!-- layer:L0 label:instructions tokens:120 cached:yes -->",
    "Be helpful.",
    "<!-- /layer:L0 -->",
    "",
    "<!-- layer:L1 label:source tokens:4300 cached:yes -->",
    "PR #5020",
    "Diff: 8 hunks",
    "<!-- /layer:L1 -->",
    "",
    "<!-- layer:L4 label:explain tokens:40 cached:no -->",
    "(no text selected)",
    "<!-- /layer:L4 -->",
  ].join("\n");

  it("splits marked spans with flags", () => {
    const sections = splitLayers(expanded);
    expect(sections.map((s) => s.layer)).toEqual(["L0", "L1", "L4"]);
    expect(sections[0]).toMatchObject({ label: "instructions", tokens: 120, cached: true, text: "Be helpful." });
    expect(sections[1].text).toBe("PR #5020\nDiff: 8 hunks");
    expect(sections[2]).toMatchObject({ cached: false, text: "(no text selected)" });
  });

  it("never drops unmarked text", () => {
    expect(splitLayers("plain text")).toEqual([
      { layer: "", label: "text", tokens: 0, cached: false, text: "plain text" },
    ]);
    const mixed = `lead-in\n${expanded}\ntrail-out`;
    const sections = splitLayers(mixed);
    expect(sections[0]).toMatchObject({ layer: "", text: "lead-in" });
    expect(sections[sections.length - 1]).toMatchObject({ layer: "", text: "trail-out" });
    expect(splitLayers("")).toEqual([]);
  });
});

describe("version copy", () => {
  it("counts and headlines", () => {
    expect(versionCountsText({ changedHunks: 1, newHunks: 2, removedHunks: 0 })).toBe(
      "1 changed · 2 new · 0 removed",
    );
    expect(
      staleHeadline({
        stale: true,
        fromVersion: 1,
        toVersion: 2,
        unchangedHunks: 7,
        changedHunks: 1,
        newHunks: 2,
        removedHunks: 0,
        renamedFiles: [],
        changedOldIds: [],
        changedNewIds: [],
        rangeDiff: "",
        fetchedAt: 0,
      }),
    ).toBe("New commits on this branch: v1 → v2 (1 changed · 2 new · 0 removed hunks)");
  });
});
