/** Version-picker display helpers: grouping, short shas, relative times, outcome copy. */
import { describe, expect, it } from "vitest";
import { buildLine, groupChannels, isNewerAvailable, outcomeLine, shortCommit, timeAgoIso } from "./versionFormat.js";
import type { UpdateChannel } from "@unvibe/shared";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function channel(ref: string, kind: UpdateChannel["kind"]): UpdateChannel {
  return { ref, kind, version: "0.0.1", commit: null, sourceBranch: null, builtAt: null, current: false };
}

describe("versionFormat", () => {
  it("groups channels release / rc / previews", () => {
    const groups = groupChannels([
      channel("release", "release"),
      channel("preview/a", "preview"),
      channel("release-rc", "release-rc"),
      channel("preview/b", "preview"),
    ]);
    expect(groups.release.map((c) => c.ref)).toEqual(["release"]);
    expect(groups.releaseRc.map((c) => c.ref)).toEqual(["release-rc"]);
    expect(groups.previews.map((c) => c.ref)).toEqual(["preview/a", "preview/b"]);
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
    const build = { version: "0.0.1", sourceBranch: null, commit: "aaa", builtAt: null };
    const row = (commit: string | null, current: boolean): UpdateChannel => ({
      ref: "preview/a",
      kind: "preview",
      version: "0.0.1",
      commit,
      sourceBranch: "a",
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
        { version: "0.0.1-preview.feat-x.abc1234", sourceBranch: "feat/x", commit: "abc1234def", builtAt: null },
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
});
