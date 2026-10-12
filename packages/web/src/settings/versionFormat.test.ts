/** Version-picker display helpers: grouping, short shas, relative times, outcome copy. */
import { describe, expect, it } from "vitest";
import {
  blockedJobLine,
  buildLine,
  isNewerAvailable,
  mergedProvenance,
  outcomeLine,
  shortCommit,
  sortVersionsByRecency,
  timeAgoIso,
} from "./versionFormat.js";
import type { UpdateChannel } from "@unvibe/shared";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function channel(ref: string, kind: UpdateChannel["kind"], builtAt: string | null = null): UpdateChannel {
  return { ref, kind, version: "0.0.1", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt, current: false };
}

describe("versionFormat", () => {
  it("sorts versions newest build first, missing builtAt last in list order", () => {
    const iso = (ms: number): string => new Date(NOW - ms).toISOString();
    const rows = sortVersionsByRecency([
      channel("release", "release"),
      channel("preview/old", "preview", iso(86400_000)),
      channel("preview/new", "preview", iso(3600_000)),
      channel("release-rc", "release-rc", iso(7200_000)),
      channel("preview/no-time", "preview"),
      channel("preview/bogus", "preview", "not-a-date"),
    ]);
    expect(rows.map((c) => c.ref)).toEqual([
      "preview/new",
      "release-rc",
      "preview/old",
      "release",
      "preview/no-time",
      "preview/bogus",
    ]);
  });

  it("shortens shas and times relatively", () => {
    expect(shortCommit("abc1234def")).toBe("abc1234");
    expect(shortCommit(null)).toBeNull();
    expect(timeAgoIso(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
    expect(timeAgoIso(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
    expect(timeAgoIso(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe("3h ago");
    expect(timeAgoIso(new Date(NOW - 2 * 86400_000).toISOString(), NOW)).toBe("2d ago");
    expect(timeAgoIso(null)).toBeNull();
    expect(timeAgoIso("bogus")).toBeNull();
  });

  it("flags a newer published build on the installed channel only", () => {
    const build = { version: "0.0.1", sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: "aaa", builtAt: null };
    const row = (commit: string | null, current: boolean): UpdateChannel => ({
      ref: "preview/a",
      kind: "preview",
      version: "0.0.1",
      commit,
      sourceBranch: "a",
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      builtAt: null,
      current,
    });
    expect(isNewerAvailable(row("bbb", true), build)).toBe(true);
    expect(isNewerAvailable(row("aaa", true), build)).toBe(false);
    expect(isNewerAvailable(row(null, true), build)).toBe(false);
    expect(isNewerAvailable(row("bbb", false), build)).toBe(false);
    expect(isNewerAvailable(row("bbb", true), null)).toBe(false);
  });

  it("describes the running build and the last outcome", () => {
    expect(buildLine(null, "0.0.1")).toBe("on 0.0.1");
    expect(
      buildLine(
        { version: "0.0.1-preview.feat-x.abc1234", sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, commit: "abc1234def", builtAt: null },
        "0.0.1",
      ),
    ).toBe("on 0.0.1-preview.feat-x.abc1234 (feat/x · abc1234)");
    expect(
      outcomeLine({
        status: "rolled-back",
        from: "release",
        to: "preview/a",
        reason: "boom",
        finishedAt: new Date(NOW - 60_000).toISOString(),
      }),
    ).toContain("Rolled back to release — boom");
    expect(
      outcomeLine({ status: "ok", from: "release", to: "preview/a", finishedAt: new Date(NOW - 1000).toISOString() }),
    ).toContain("Switched to preview/a");
  });

  it("names both sides of a merged preview, null otherwise", () => {
    const merged = {
      sourceBranch: "feat/x",
      sourceCommit: "aaa111122223333",
      baseBranch: "main",
      baseCommit: "bbb222233334444",
    };
    expect(mergedProvenance(merged)).toBe("main@bbb2222 + feat/x@aaa1111");
    expect(
      buildLine({ version: "0.0.1-preview.feat-x.abc1234", ...merged, commit: "merge9999", builtAt: null }, "0.0.1"),
    ).toBe("on 0.0.1-preview.feat-x.abc1234 (main@bbb2222 + feat/x@aaa1111)");
    expect(mergedProvenance(null)).toBeNull();
    expect(mergedProvenance({ ...merged, baseCommit: null })).toBeNull();
  });

  it("names the interrupted count of a forced switch", () => {
    expect(
      outcomeLine({
        status: "ok",
        from: "release",
        to: "preview/a",
        interruptedJobs: 2,
        finishedAt: new Date(NOW - 1000).toISOString(),
      }),
    ).toContain("Switched to preview/a · 2 jobs interrupted");
    expect(
      outcomeLine({
        status: "ok",
        from: "release",
        to: "preview/a",
        interruptedJobs: 1,
        finishedAt: new Date(NOW - 1000).toISOString(),
      }),
    ).toContain("1 job interrupted");
    expect(
      outcomeLine({
        status: "rolled-back",
        from: "release",
        to: "preview/a",
        reason: "boom",
        interruptedJobs: 3,
        finishedAt: new Date(NOW - 60_000).toISOString(),
      }),
    ).toContain("3 jobs interrupted");
  });

  it("renders one blocked job as a quiet line", () => {
    expect(
      blockedJobLine({ id: "j1", kind: "explain", reviewId: "demo", state: "running", label: "Streaming answer…" }),
    ).toBe("explain · demo · running — Streaming answer…");
    expect(blockedJobLine({ id: "j2", kind: "reader", state: "queued" })).toBe("reader · queued");
  });
});
