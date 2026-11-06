/**
 * Debug channels (issue #356): `release-debug` and `preview/<slug>-debug`
 * validate, sort after their lean twin, infer from `-debug` versions,
 * and render marked as debug.
 */
import { describe, expect, it } from "vitest";
import {
  formatChannelList,
  inferChannelFromVersion,
  isChannelName,
  parseChannelList,
  type InstalledBuild,
} from "../src/update/channels.js";
import { buildReleaseArgs } from "../../../scripts/preview-lib.mjs";

const INSTALLED: InstalledBuild = {
  version: "0.0.17",
  dataFormat: 1,
  channel: "release",
  sourceBranch: null,
  sourceCommit: null,
  baseBranch: null,
  baseCommit: null,
  commit: "c0ffee1",
  builtAt: null,
  packagePath: null,
};

describe("debug channels (#356)", () => {
  it("validates release-debug and preview debug refs, rejects others", () => {
    expect(isChannelName("release")).toBe(true);
    expect(isChannelName("release-debug")).toBe(true);
    expect(isChannelName("preview/feat-x")).toBe(true);
    expect(isChannelName("preview/feat-x-debug")).toBe(true);
    for (const bad of ["debug", "release-debug/x", "preview/", "preview//debug", "RELEASE-DEBUG"]) {
      expect(isChannelName(bad), bad).toBe(false);
    }
  });

  it("sorts release, release-debug, then previews", () => {
    expect(parseChannelList("preview/b\nrelease-debug\npreview/a\nrelease\nrelease\n")).toEqual([
      "release",
      "release-debug",
      "preview/a",
      "preview/b",
    ]);
  });

  it("infers release-debug from -debug versions", () => {
    expect(inferChannelFromVersion("0.0.17")).toBe("release");
    expect(inferChannelFromVersion("0.0.17-debug")).toBe("release-debug");
    expect(inferChannelFromVersion("0.0.17-preview.feat-x-debug.abc1234")).toBe("preview/feat-x-debug");
  });

  it("marks debug channels in the --list output", () => {
    const lines = formatChannelList(
      [
        { ref: "release", kind: "release", version: "0.0.17", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: true },
        { ref: "release-debug", kind: "release", version: "0.0.17-debug", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: false },
        { ref: "preview/feat-x-debug", kind: "preview", version: "0.0.17-preview.feat-x-debug.abc", commit: null, sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, dataFormat: 1, current: false },
      ],
      INSTALLED,
    );
    expect(lines.some((l) => l.includes("release-debug") && l.includes("[debug"))).toBe(true);
    expect(lines.some((l) => l.includes("preview/feat-x-debug") && l.includes("[debug"))).toBe(true);
    expect(lines.filter((l) => l.includes("[debug")).length).toBe(2);
  });

  it("preview --debug appends the flag to release args", () => {
    expect(
      buildReleaseArgs({ version: "0.0.17", branch: "preview/x-debug", debug: true }),
    ).toContain("--debug");
    expect(
      buildReleaseArgs({ version: "0.0.17", branch: "preview/x" }),
    ).not.toContain("--debug");
  });
});
