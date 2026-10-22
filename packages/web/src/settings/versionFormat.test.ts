/** Version-picker display helpers: grouping, short shas, relative times, outcome copy. */
import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  badgeTitle,
  blockedJobLine,
  buildLine,
  channelRowState,
  compareReleaseVersions,
  findUpdateAvailable,
  isNewerAvailable,
  mergedProvenance,
  outcomeLine,
  shortCommit,
  sortVersionsByRecency,
  timeAgoIso,
} from "./versionFormat.js";
import type { UpdateBuildInfo, UpdateChannel } from "@unvibe/shared";

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
    const build = { version: "0.0.1", channel: "preview/a", sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: "aaa", builtAt: null };
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
        { version: "0.0.1-preview.feat-x.abc1234", channel: "preview/feat-x", sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, commit: "abc1234def", builtAt: null },
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
      buildLine({ version: "0.0.1-preview.feat-x.abc1234", channel: "preview/feat-x", ...merged, commit: "merge9999", builtAt: null }, "0.0.1"),
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

  it("classifies channel rows: up to date, newer available, other channel", () => {
    const build = { version: "0.0.1", channel: "preview/a", sourceBranch: "a", sourceCommit: null, baseBranch: null, baseCommit: null, commit: "aaa1111", builtAt: null };
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
    expect(channelRowState(row("aaa1111", true), build)).toBe("installed");
    expect(channelRowState(row("bbb2222", true), build)).toBe("update-available");
    expect(channelRowState(row("bbb2222", false), build)).toBe("other");
  });

  it("keeps the badge short and puts bases and build time in the title", () => {
    const build = {
      version: "0.0.1-preview.main-rc.6818b23",
      channel: "preview/main-rc",
      sourceBranch: "main-rc",
      sourceCommit: "6818b23aaaaaaa",
      baseBranch: "main",
      baseCommit: "c562ed1bbbbbbb",
      commit: "ffff000011112222",
      builtAt: new Date(NOW - 3 * 3600_000).toISOString(),
    };
    expect(badgeLabel(build)).toBe("preview · main-rc · 6818b23");
    const title = badgeTitle(build, NOW);
    expect(title).toContain("0.0.1-preview.main-rc.6818b23");
    expect(title).toContain("main@c562ed1 + main-rc@6818b23");
    expect(title).toContain("built 3h ago");
  });

  it("compares release versions numerically, release beats pre-release", () => {
    expect(compareReleaseVersions("0.0.2", "0.0.1")).toBe(1);
    expect(compareReleaseVersions("0.0.1", "0.0.2")).toBe(-1);
    expect(compareReleaseVersions("0.0.1", "0.0.1")).toBe(0);
    expect(compareReleaseVersions("0.0.10", "0.0.9")).toBe(1);
    expect(compareReleaseVersions("0.0.1", "0.0.1-rc.1")).toBe(1);
    expect(compareReleaseVersions("0.0.1-rc.1", "0.0.1")).toBe(-1);
    expect(compareReleaseVersions("0.0.1-rc.2", "0.0.1-rc.1")).toBe(1);
  });

  it("finds the update: release builds by version, previews by date", () => {
    const T0 = new Date(NOW - 3 * 86400_000).toISOString();
    const T1 = new Date(NOW - 86400_000).toISOString();
    const release = (version: string | null, builtAt: string | null): UpdateChannel => ({
      ref: "release",
      kind: "release",
      version,
      commit: "b535a30ccccccc",
      sourceBranch: null,
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      builtAt,
      current: false,
    });
    const channels = (version: string | null, builtAt: string | null): UpdateChannel[] => [release(version, builtAt)];
    const build = (over: Partial<UpdateBuildInfo>): UpdateBuildInfo => ({
      version: "0.0.1",
      channel: "release",
      sourceBranch: null,
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      commit: "aaa1111",
      builtAt: T0,
      ...over,
    });

    // Release build, newer release published: the release channel.
    expect(findUpdateAvailable(build({}), channels("0.0.2", T1))).toEqual(release("0.0.2", T1));
    // Up to date: nothing.
    expect(findUpdateAvailable(build({}), channels("0.0.1", T1))).toBeNull();
    // Release candidate build, final release out: newer by version.
    expect(findUpdateAvailable(build({ version: "0.0.1-rc.1", channel: "release-rc" }), channels("0.0.1", T1))).toEqual(
      release("0.0.1", T1),
    );
    // Preview build, release published after the preview was built.
    expect(
      findUpdateAvailable(build({ version: "0.0.1-preview.x.abc", channel: "preview/x", builtAt: T0 }), channels("0.0.1", T1)),
    ).toEqual(release("0.0.1", T1));
    // Preview build newer than the release: nothing.
    expect(
      findUpdateAvailable(build({ version: "0.0.1-preview.x.abc", channel: "preview/x", builtAt: T1 }), channels("0.0.1", T0)),
    ).toBeNull();
    // Undeterminable: no icon, never an error.
    expect(findUpdateAvailable(null, channels("0.0.2", T1))).toBeNull();
    expect(findUpdateAvailable(build({ channel: null }), channels("0.0.2", T1))).toBeNull();
    expect(findUpdateAvailable(build({}), channels(null, T1))).toBeNull();
    expect(findUpdateAvailable(build({}), [])).toBeNull();
    // Release builds compare by version alone: missing build times don't matter.
    expect(findUpdateAvailable(build({ builtAt: null }), channels("0.0.2", null))).toEqual(release("0.0.2", null));
    // Preview builds need both build times.
    expect(
      findUpdateAvailable(
        build({ version: "0.0.1-preview.x.abc", channel: "preview/x", builtAt: null }),
        channels("0.0.1", T1),
      ),
    ).toBeNull();
    expect(
      findUpdateAvailable(
        build({ version: "0.0.1-preview.x.abc", channel: "preview/x", builtAt: "bogus" }),
        channels("0.0.1", T1),
      ),
    ).toBeNull();
  });

  it("renders one blocked job as a quiet line", () => {
    expect(
      blockedJobLine({ id: "j1", kind: "explain", reviewId: "demo", state: "running", label: "Streaming answer…" }),
    ).toBe("explain · demo · running — Streaming answer…");
    expect(blockedJobLine({ id: "j2", kind: "reader", state: "queued" })).toBe("reader · queued");
  });
});
