/**
 * `unvibe update` (issue #36, step 1 + review fixes): channel listing
 * parsing (incl. per-ref metadata without cloning), the install command
 * built for a channel, same-channel reinstalls, channel inference,
 * prefix pinning, and the DB backup rule against a temp data dir
 * (switching keeps the live database and backs it up first; rollback
 * restores the pre-switch backup). No network, no real gh/git/npm: `gh`
 * and `npm` go through the injectable command runner (faked here).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeLock } from "../src/cli/lock.js";
import {
  runUpdateChannelFlow,
  runUpdateListFlow,
} from "../src/cli/update-flows.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/runner.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  backupChannel,
  channelSlotDir,
  restoreChannel,
} from "../src/update/data-backup.js";
import { runSwitchCore } from "../src/update/switch.js";
import {
  channelKind,
  decodeRefPackage,
  formatChannelList,
  inferChannelFromVersion,
  isChannelName,
  listChannels,
  parseChannelList,
  readInstalledBuild,
  shortCommit,
} from "../src/update/channels.js";
import type { InstalledBuild, UpdateChannel } from "../src/update/channels.js";
import { installPrefixForPackage, installRef, installSpec, stableNpmCwd } from "../src/update/install.js";

function tmpDir(prefix: string): string {
  // realpath: macOS's tmpdir is a symlink (/var -> /private/var) and the code under test resolves it.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Fake install tree: <dir>/package.json + a CLI script path inside it. */
function makeInstall(dir: string, pkg: unknown): { scriptPath: string; packagePath: string } {
  const packagePath = path.join(dir, "package.json");
  fs.mkdirSync(path.join(dir, "packages", "service", "dist"), { recursive: true });
  fs.writeFileSync(packagePath, JSON.stringify(pkg));
  const scriptPath = path.join(dir, "packages", "service", "dist", "index.js");
  fs.writeFileSync(scriptPath, "");
  return { scriptPath, packagePath };
}

/** npm-layout install: <root>/lib/node_modules/unvibe/{package.json,...}. */
function makePrefixedInstall(
  root: string,
  pkg: unknown,
): { scriptPath: string; packagePath: string; prefix: string } {
  const prefix = path.join(root, "prefix");
  const made = makeInstall(path.join(prefix, "lib", "node_modules", "unvibe"), pkg);
  return { ...made, prefix };
}

/** `gh api .../contents/package.json` response body for a package. */
function contentsStdout(pkg: unknown): string {
  return JSON.stringify({
    content: Buffer.from(JSON.stringify(pkg)).toString("base64"),
    encoding: "base64",
  });
}

function installed(channel: string | null, version = "0.0.1"): InstalledBuild {
  return { version, channel, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, commit: null, builtAt: null, packagePath: null };
}

describe("channel names + install specs", () => {
  it("accepts release and preview/* only", () => {
    expect(isChannelName("release")).toBe(true);
    expect(isChannelName("preview/feat-x")).toBe(true);
    expect(isChannelName("preview/a.b_c-d")).toBe(true);
    for (const bad of ["", "main", "release-rc", "preview/", "preview/a/b", "preview/../x", "Release", "Preview/x"]) {
      expect(isChannelName(bad), bad).toBe(false);
    }
  });

  it("maps refs to kinds", () => {
    expect(channelKind("release")).toBe("release");
    expect(channelKind("preview/feat-x")).toBe("preview");
  });

  it("builds the npm install spec for a channel", () => {
    expect(installSpec("release")).toBe("github:indigoviolet/unvibe#release");
    expect(installSpec("preview/feat-x")).toBe("github:indigoviolet/unvibe#preview/feat-x");
    expect(() => installSpec("main")).toThrow();
    expect(() => installSpec("release-rc")).toThrow();
  });

  it("installs the channel ref globally through the runner", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "npm", stdout: "added 1 package", stderr: "", code: 0 });
    const res = await installRef(runner, "preview/feat-x");
    expect(res.code).toBe(0);
    // Stable cwd (issue #42 regression): npm must not inherit a cwd
    // inside the package it is replacing, which it deletes mid-install.
    expect(runner.calls).toEqual([
      {
        cmd: "npm",
        opts: { args: ["install", "-g", "github:indigoviolet/unvibe#preview/feat-x"], cwd: stableNpmCwd() },
      },
    ]);
    await expect(installRef(runner, "main")).rejects.toThrow();
  });

  it("picks a stable npm cwd that survives the install", () => {
    expect(stableNpmCwd("/home/u")).toBe("/home/u");
    expect(stableNpmCwd("")).toBe(os.tmpdir());
    expect(path.isAbsolute(stableNpmCwd())).toBe(true);
  });

  it("pins --prefix when asked", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "npm", stdout: "", stderr: "", code: 0 });
    await installRef(runner, "release", { prefix: "/p" });
    expect(runner.calls[0].opts.args).toEqual(["install", "-g", "github:indigoviolet/unvibe#release", "--prefix", "/p"]);
  });

  it("derives --prefix from npm-layout package paths only", () => {
    const prefix = path.join("tmp", "prefix");
    const lib = [prefix, "lib", "node_modules", "unvibe", "package.json"].join(path.sep);
    expect(installPrefixForPackage(lib)).toBe(prefix);
    expect(installPrefixForPackage(path.join("repo", "package.json"))).toBeNull();
    expect(installPrefixForPackage(path.join("x", "node_modules", "unvibe", "package.json"))).toBeNull();
    expect(installPrefixForPackage(null)).toBeNull();
  });

  it("parses gh branch output into sorted, deduped channels", () => {
    const out = parseChannelList(
      ["release", "main", "preview/b", "release-rc", "preview/a", "preview/b", "", "  "].join("\n"),
    );
    // A stale `release-rc` remote branch is not a channel: dropped like `main`.
    expect(out).toEqual(["release", "preview/a", "preview/b"]);
  });
});

describe("inferChannelFromVersion", () => {
  it("maps hand-installed versions to their channels", () => {
    expect(inferChannelFromVersion("0.0.1")).toBe("release");
    expect(inferChannelFromVersion("0.0.1-preview.feat-x.abc1234")).toBe("preview/feat-x");
    expect(inferChannelFromVersion("0.0.1-preview.a.b")).toBe("preview/a");
    expect(inferChannelFromVersion("nope")).toBeNull();
    expect(inferChannelFromVersion("0.0.1-foo.2")).toBeNull();
    // Old `-rc.N` builds predate the channel removal: unknown.
    expect(inferChannelFromVersion("0.0.1-rc.2")).toBeNull();
  });

  it("shortens commits for display", () => {
    expect(shortCommit("abc1234full")).toBe("abc1234");
    expect(shortCommit(null)).toBe("(unknown)");
  });
});

describe("per-ref metadata without cloning", () => {
  const previewPkg = {
    name: "unvibe",
    version: "0.0.1-preview.feat-x.abc1234",
    unvibe: {
      channel: "preview/feat-x",
      commit: "abc1234full",
      builtAt: "2026-10-12T00:50:12.402Z",
      sourceBranch: "feat/x",
      sourceVersion: "0.0.1",
      sourceCommit: "aaa111122223333",
      baseBranch: "main",
      baseCommit: "bbb222233334444",
    },
  };

  it("decodes a gh contents response into version + provenance", () => {
    expect(decodeRefPackage(contentsStdout(previewPkg))).toEqual({
      version: "0.0.1-preview.feat-x.abc1234",
      commit: "abc1234full",
      sourceBranch: "feat/x",
      sourceCommit: "aaa111122223333",
      baseBranch: "main",
      baseCommit: "bbb222233334444",
      builtAt: "2026-10-12T00:50:12.402Z",
    });
  });

  it("returns nulls for unreadable responses (old builds without metadata stay listed)", () => {
    const blank = { version: null, commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null };
    expect(decodeRefPackage("not json")).toEqual(blank);
    expect(decodeRefPackage(JSON.stringify({ content: "!!!not-base64!!!" }))).toEqual(blank);
    expect(decodeRefPackage(contentsStdout({ name: "unvibe", version: "0.0.1" }))).toEqual({
      ...blank,
      version: "0.0.1",
    });
  });

  it("lists channels with metadata per ref, marking the installed one", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/branches", "--paginate", "-q", ".[].name"],
      stdout: ["release", "preview/feat-x"].join("\n"),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=release"],
      stdout: contentsStdout({ name: "unvibe", version: "0.0.1" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: contentsStdout(previewPkg),
      stderr: "",
      code: 0,
    });
    const channels = await listChannels(runner, installed("release"));
    expect(channels).toEqual([
      {
        ref: "release",
        kind: "release",
        version: "0.0.1",
        commit: null,
        sourceBranch: null,
        sourceCommit: null,
        baseBranch: null,
        baseCommit: null,
        builtAt: null,
        current: true,
      },
      {
        ref: "preview/feat-x",
        kind: "preview",
        version: "0.0.1-preview.feat-x.abc1234",
        commit: "abc1234full",
        sourceBranch: "feat/x",
        sourceCommit: "aaa111122223333",
        baseBranch: "main",
        baseCommit: "bbb222233334444",
        builtAt: "2026-10-12T00:50:12.402Z",
        current: false,
      },
    ]);
    // gh ran with GITHUB_TOKEN unset (PRD §15).
    for (const call of runner.calls) {
      expect(call.cmd).toBe("gh");
      expect(call.opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
    }
  });

  it("blanks one bad ref instead of failing the list", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/branches", "--paginate", "-q", ".[].name"],
      stdout: "release",
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=release"],
      stdout: "",
      stderr: "not found",
      code: 1,
    });
    const channels = await listChannels(runner, installed(null, "0"));
    expect(channels).toEqual([
      {
        ref: "release",
        kind: "release",
        version: null,
        commit: null,
        sourceBranch: null,
        sourceCommit: null,
        baseBranch: null,
        baseCommit: null,
        builtAt: null,
        current: false,
      },
    ]);
  });

  it("throws when the branch list itself fails", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "auth failed", code: 1 });
    await expect(listChannels(runner, installed(null, "0"))).rejects.toThrow(/gh exited 1/);
  });

  it("formats the list with versions, provenance and newer-build notes", () => {
    const rows: UpdateChannel[] = [
      { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, current: false },
      { ref: "preview/feat-x", kind: "preview", version: "0.0.1-preview.feat-x.abc1234", commit: "abc1234full", sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: "2026-10-12T00:50:12.402Z", current: true },
      { ref: "preview/gone", kind: "preview", version: null, commit: null, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, current: false },
    ];
    const lines = formatChannelList(rows, {
      ...installed("preview/feat-x", "0.0.1-preview.feat-x.older"),
      commit: "older1234full",
    });
    expect(lines).toContain(
      "* preview/feat-x (installed, 0.0.1-preview.feat-x.older) — newer build available (installed older12 vs abc1234, built 2026-10-12)",
    );
    expect(lines).toContain("  release (0.0.1)");
    expect(lines).toContain("  preview/gone (no build details)");
    expect(lines[lines.length - 1]).toMatch(/unvibe update <channel>/);
  });

  it("notes a newer build on the current row with both commits and the build time", () => {
    const rows: UpdateChannel[] = [
      { ref: "preview/feat-x", kind: "preview", version: "0.0.1-preview.feat-x.abc1234", commit: "abc1234full", sourceBranch: "feat/x", sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: "2026-10-12T00:50:12.402Z", current: true },
    ];
    const lines = formatChannelList(rows, { ...installed("preview/feat-x", "0.0.1-preview.feat-x.older"), commit: "older1234full" });
    expect(lines).toContain(
      "* preview/feat-x (installed, 0.0.1-preview.feat-x.older) — newer build available (installed older12 vs abc1234, built 2026-10-12)",
    );
  });

  it("names both sides of a merged preview, single side for older builds", () => {
    const rows: UpdateChannel[] = [
      { ref: "preview/feat-x", kind: "preview", version: "0.0.1-preview.feat-x.abc1234", commit: "merge9999full", sourceBranch: "feat/x", sourceCommit: "aaa111122223333", baseBranch: "main", baseCommit: "bbb222233334444", builtAt: "2026-10-12T00:50:12.402Z", current: false },
      { ref: "preview/old", kind: "preview", version: "0.0.1-preview.old.abc1234", commit: "abc1234full", sourceBranch: "old", sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, current: false },
    ];
    const lines = formatChannelList(rows, installed("release"));
    expect(lines).toContain("    from main@bbb2222 + feat/x@aaa1111, built 2026-10-12");
    expect(lines).toContain("    from old @ abc1234");
  });

  it("stays quiet on the current row when commits match or are unknown", () => {
    const row = (commit: string | null): UpdateChannel[] => [
      { ref: "release", kind: "release", version: "0.0.1", commit, sourceBranch: null, sourceCommit: null, baseBranch: null, baseCommit: null, builtAt: null, current: true },
    ];
    expect(formatChannelList(row("same1234"), { ...installed("release"), commit: "same1234" })).toContain(
      "* release (installed, 0.0.1)",
    );
    const quiet = formatChannelList(row(null), installed("release"));
    expect(quiet.some((l) => l.includes("newer build"))).toBe(false);
  });
});

describe("readInstalledBuild", () => {
  it("reads version + channel + provenance from the installed package.json", () => {
    const root = tmpDir("unvibe-installed-");
    const { scriptPath, packagePath } = makeInstall(path.join(root, "pkg"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: {
        channel: "preview/feat-x",
        commit: "abc1234full",
        builtAt: "2026-10-12T00:50:12.402Z",
        sourceBranch: "feat/x",
        sourceVersion: "0.0.1",
      },
    });
    expect(readInstalledBuild(scriptPath, "fallback")).toEqual({
      version: "0.0.1-preview.feat-x.abc1234",
      channel: "preview/feat-x",
      sourceBranch: "feat/x",
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      commit: "abc1234full",
      builtAt: "2026-10-12T00:50:12.402Z",
      packagePath,
    });
  });

  it("reads both sides of a merged preview; old builds keep nulls", () => {
    const root = tmpDir("unvibe-installed-merged-");
    const { scriptPath, packagePath } = makeInstall(path.join(root, "pkg"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: {
        channel: "preview/feat-x",
        commit: "merge9999full",
        builtAt: "2026-10-12T00:50:12.402Z",
        sourceBranch: "feat/x",
        sourceVersion: "0.0.1",
        sourceCommit: "aaa111122223333",
        baseBranch: "main",
        baseCommit: "bbb222233334444",
      },
    });
    expect(readInstalledBuild(scriptPath, "fallback")).toEqual({
      version: "0.0.1-preview.feat-x.abc1234",
      channel: "preview/feat-x",
      sourceBranch: "feat/x",
      sourceCommit: "aaa111122223333",
      baseBranch: "main",
      baseCommit: "bbb222233334444",
      commit: "merge9999full",
      builtAt: "2026-10-12T00:50:12.402Z",
      packagePath,
    });
  });

  it("infers the channel from the version for hand installs predating the field", () => {
    const old = makeInstall(tmpDir("unvibe-installed-old-"), { name: "unvibe", version: "0.0.1" });
    expect(readInstalledBuild(old.scriptPath, "fallback").channel).toBe("release");
    const rc = makeInstall(tmpDir("unvibe-installed-rc-"), { name: "unvibe", version: "0.0.1-rc.2" });
    expect(readInstalledBuild(rc.scriptPath, "fallback").channel).toBeNull();
    const prev = makeInstall(tmpDir("unvibe-installed-prev-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
    });
    expect(readInstalledBuild(prev.scriptPath, "fallback").channel).toBe("preview/feat-x");
    const weird = makeInstall(tmpDir("unvibe-installed-weird-"), { name: "unvibe", version: "0.0.2-foo" });
    expect(readInstalledBuild(weird.scriptPath, "fallback").channel).toBeNull();
  });

  it("keeps source checkouts unknown even with a release-like version", () => {
    const src = makeInstall(tmpDir("unvibe-source-"), {
      name: "unvibe",
      version: "0.0.1",
      private: true,
    });
    const got = readInstalledBuild(src.scriptPath, "fallback");
    expect(got.channel).toBeNull();
    expect(got.version).toBe("0.0.1");
  });

  it("resolves the global bin symlink to the installed package", () => {
    const root = tmpDir("unvibe-installed-link-");
    const { scriptPath } = makeInstall(path.join(root, "pkg"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x" },
    });
    const binDir = path.join(root, "prefix", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, "unvibe");
    fs.symlinkSync(scriptPath, link);
    const got = readInstalledBuild(link, "fallback");
    expect(got.channel).toBe("preview/feat-x");
    expect(got.version).toBe("0.0.1-preview.feat-x.abc1234");
  });

  it("falls back cleanly with garbage or no package", () => {
    const garbage = makeInstall(tmpDir("unvibe-installed-garbage-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "main" },
    });
    // "main" is not a channel, and 0.0.1 infers release — but an explicit
    // (invalid) field wins over inference only when valid, so this falls
    // back to the version inference.
    expect(readInstalledBuild(garbage.scriptPath, "fallback").channel).toBe("release");

    expect(readInstalledBuild(undefined, "fallback")).toEqual({
      version: "fallback",
      channel: null,
      sourceBranch: null,
      sourceCommit: null,
      baseBranch: null,
      baseCommit: null,
      commit: null,
      builtAt: null,
      packagePath: null,
    });
    expect(
      readInstalledBuild(path.join(tmpDir("unvibe-installed-missing-"), "nope.js"), "fallback")
        .packagePath,
    ).toBeNull();
  });
});

describe("per-channel DB backup/restore", () => {
  it("backs up main + wal + shm into the channel slot", () => {
    const dataDir = tmpDir("unvibe-data-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "live");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-wal"), "wal");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-shm"), "shm");
    const res = backupChannel(dataDir, "release");
    expect(res.dir).toBe(channelSlotDir(dataDir, "release"));
    expect(res.files).toEqual(["unvibe.db", "unvibe.db-wal", "unvibe.db-shm"]);
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("live");
  });

  it("maps preview/ channels to one slot segment; unknown installs to _unknown", () => {
    const dataDir = tmpDir("unvibe-slots-");
    expect(channelSlotDir(dataDir, "preview/feat-x")).toBe(
      path.join(dataDir, "channel-backups", "preview-feat-x"),
    );
    expect(channelSlotDir(dataDir, null)).toBe(
      path.join(dataDir, "channel-backups", "_unknown"),
    );
  });

  it("restores a slot over live files, clearing stale journals, keeping other slots", () => {
    const dataDir = tmpDir("unvibe-restore-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    backupChannel(dataDir, "release");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-db");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-wal"), "stale-wal");
    backupChannel(dataDir, "preview/feat-x");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-db-2");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-wal"), "stale-wal-2");
    const restored = restoreChannel(dataDir, "release");
    expect(restored.files).toEqual(["unvibe.db"]);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.existsSync(path.join(dataDir, "unvibe.db-wal"))).toBe(false);
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "preview/feat-x"), "unvibe.db"), "utf8")).toBe(
      "preview-db",
    );
  });

  it("backs up nothing on a fresh machine, without failing", () => {
    const dataDir = tmpDir("unvibe-fresh-");
    const res = backupChannel(dataDir, "release");
    expect(res.files).toEqual([]);
  });
});

/**
 * Serves gh contents for canned ref packages, rewrites package.json on
 * `npm install` (null = install lands elsewhere), answers `npm prefix -g`.
 */
class SwitchRunner implements CommandRunner {
  readonly calls: { cmd: string; opts: RunOptions }[] = [];
  constructor(
    private packagePath: string,
    private nextPkg: unknown | null,
    private refPkgs: Record<string, unknown> = {},
    private prefixOut = "/fake/prefix",
  ) {}
  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    this.calls.push({ cmd, opts });
    if (cmd === "npm" && opts.args[0] === "install") {
      if (this.nextPkg !== null) fs.writeFileSync(this.packagePath, JSON.stringify(this.nextPkg));
      return { stdout: "added 1 package", stderr: "", code: 0 };
    }
    if (cmd === "npm" && opts.args[0] === "prefix") {
      return { stdout: `${this.prefixOut}\n`, stderr: "", code: 0 };
    }
    if (cmd === "gh") {
      const m = /contents\/package\.json\?ref=(.+)$/.exec(opts.args[1] ?? "");
      const pkg = m ? this.refPkgs[m[1]] : undefined;
      if (pkg === undefined) return { stdout: "", stderr: "not found", code: 1 };
      return { stdout: contentsStdout(pkg), stderr: "", code: 0 };
    }
    throw new Error(`unexpected command: ${cmd} ${opts.args.join(" ")}`);
  }
}

const BRANCHES = ["release", "preview/feat-x", "main"].join("\n");

function enqueueContents(runner: FakeCommandRunner, ref: string, pkg: unknown): void {
  runner.enqueue({
    cmd: "gh",
    args: ["api", `repos/indigoviolet/unvibe/contents/package.json?ref=${ref}`],
    stdout: contentsStdout(pkg),
    stderr: "",
    code: 0,
  });
}

describe("runUpdateListFlow", () => {
  it("lists channels via gh, marking the installed one", async () => {
    const { scriptPath } = makeInstall(tmpDir("unvibe-list-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/branches", "--paginate", "-q", ".[].name"],
      stdout: BRANCHES,
      stderr: "",
      code: 0,
    });
    enqueueContents(runner, "release", { name: "unvibe", version: "0.0.1" });
    enqueueContents(runner, "preview/feat-x", {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234", sourceBranch: "feat/x", builtAt: "2026-10-12" },
    });
    const out = await runUpdateListFlow({
      runner,
      dataDir: tmpDir("unvibe-list-data-"),
      cliScriptPath: scriptPath,
      serviceVersion: "0.0.1",
    });
    expect(out.code).toBe(0);
    expect(out.lines).toContain("installed: release 0.0.1");
    expect(out.lines).toContain("* release (installed, 0.0.1)");
    expect(out.lines).toContain("  preview/feat-x (0.0.1-preview.feat-x.abc1234)");
    expect(out.lines).toContain("    from feat/x @ abc1234, built 2026-10-12");
    expect(out.lines.some((l) => l.includes("main"))).toBe(false);
  });

  it("flags a newer build on the installed row", async () => {
    const { scriptPath } = makeInstall(tmpDir("unvibe-list-newer-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.older",
      unvibe: { channel: "preview/feat-x", commit: "older1234full" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/branches", "--paginate", "-q", ".[].name"],
      stdout: "preview/feat-x",
      stderr: "",
      code: 0,
    });
    enqueueContents(runner, "preview/feat-x", {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234full", sourceBranch: "feat/x", builtAt: "2026-10-12" },
    });
    const out = await runUpdateListFlow({
      runner,
      dataDir: tmpDir("unvibe-list-newer-data-"),
      cliScriptPath: scriptPath,
      serviceVersion: "0",
    });
    expect(out.code).toBe(0);
    expect(
      out.lines.some((l) => l.includes("newer build available (installed older12 vs abc1234, built 2026-10-12)")),
    ).toBe(true);
  });

  it("reports gh failures with a fix hint", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "auth failed", code: 1 });
    const out = await runUpdateListFlow({
      runner,
      dataDir: tmpDir("unvibe-list-fail-"),
      cliScriptPath: undefined,
      serviceVersion: "0",
    });
    expect(out.code).toBe(1);
    expect(out.lines.some((l) => l.includes("gh auth login"))).toBe(true);
    // Public repo (issue #156): the network comes first, the login second.
    expect(out.lines.some((l) => /network/i.test(l))).toBe(true);
    expect(out.lines.some((l) => l.includes("setup-git"))).toBe(false);
  });
});

describe("runUpdateChannelFlow", () => {
  it("rejects unknown channels without touching anything", async () => {
    const runner = new FakeCommandRunner();
    const out = await runUpdateChannelFlow(
      { runner, dataDir: tmpDir("unvibe-badchan-"), cliScriptPath: undefined, serviceVersion: "0" },
      "main",
    );
    expect(out.code).toBe(2);
    expect(runner.calls).toHaveLength(0);
  });

  it("refuses while the service runs, telling the user to stop first (no restart logic)", async () => {
    const dataDir = tmpDir("unvibe-running-");
    writeLock(dataDir, { pid: process.pid, port: 4517, startedAt: "" });
    const runner = new FakeCommandRunner();
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: undefined, serviceVersion: "0" },
      "preview/feat-x",
    );
    expect(out.code).toBe(1);
    expect(out.lines.some((l) => l.includes("unvibe stop"))).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it("is a no-op with the commit when installed and published commits match", async () => {
    const { scriptPath } = makeInstall(tmpDir("unvibe-same-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
    });
    const runner = new SwitchRunner("unused", null, {
      "preview/feat-x": {
        name: "unvibe",
        version: "0.0.1-preview.feat-x.abc1234",
        unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
      },
    });
    const out = await runUpdateChannelFlow(
      { runner, dataDir: tmpDir("unvibe-same-data-"), cliScriptPath: scriptPath, serviceVersion: "0" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    expect(out.lines).toEqual(["already on preview/feat-x (0.0.1-preview.feat-x.abc1234, abc1234) — nothing to do."]);
    expect(runner.calls).toHaveLength(1); // the gh contents read only
  });

  it("reinstalls the same channel when commits differ, keeping the database", async () => {
    const dataDir = tmpDir("unvibe-reinstall-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-reinstall-installed-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.older",
      unvibe: { channel: "preview/feat-x", commit: "older1234full" },
    });
    const runner = new SwitchRunner(
      packagePath,
      {
        name: "unvibe",
        version: "0.0.1-preview.feat-x.abc1234",
        unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
      },
      {
        "preview/feat-x": {
          name: "unvibe",
          version: "0.0.1-preview.feat-x.abc1234",
          unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
        },
      },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    expect(out.lines.some((l) => l.includes("reinstalling preview/feat-x: installed older12 vs published abc1234"))).toBe(true);
    expect(out.lines.some((l) => l.includes("data kept (backed up to"))).toBe(true);
    expect(out.lines.some((l) => l.includes("Switching keeps your database"))).toBe(false);
    // Backed up first, live database untouched, no restore attempted.
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "preview/feat-x"), "unvibe.db"), "utf8")).toBe("preview-db");
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("preview-db");
    expect(runner.calls.filter((c) => c.cmd === "npm" && c.opts.args[0] === "install")).toHaveLength(1);
  });

  it("does not run setup after a successful install (issue #220: setup is manual)", async () => {
    const dataDir = tmpDir("unvibe-update-setup-");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-update-setup-installed-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.older",
      unvibe: { channel: "preview/feat-x", commit: "older1234full" },
    });
    const runner = new SwitchRunner(
      packagePath,
      {
        name: "unvibe",
        version: "0.0.1-preview.feat-x.abc1234",
        unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
      },
      {
        "preview/feat-x": {
          name: "unvibe",
          version: "0.0.1-preview.feat-x.abc1234",
          unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
        },
      },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    // Issue #220: no automatic setup after update — no setup spawn at all.
    expect(runner.calls.find((c) => c.opts.args[1] === "setup")).toBeUndefined();
  });

  it("reinstalls the same channel when the published commit is unreadable", async () => {
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-reinstall-blind-"), {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.older",
      unvibe: { channel: "preview/feat-x", commit: "older1234full" },
    });
    const runner = new SwitchRunner(packagePath, {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
    }); // no refPkgs: gh 404s
    const out = await runUpdateChannelFlow(
      { runner, dataDir: tmpDir("unvibe-reinstall-blind-data-"), cliScriptPath: scriptPath, serviceVersion: "0" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    expect(out.lines.some((l) => l.includes("could not read the published commit"))).toBe(true);
    expect(runner.calls.filter((c) => c.cmd === "npm" && c.opts.args[0] === "install")).toHaveLength(1);
  });

  it("backs up, installs the channel spec, keeps the live database, reports versions", async () => {
    const dataDir = tmpDir("unvibe-switch-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-switch-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });

    const runner = new SwitchRunner(
      packagePath,
      {
        name: "unvibe",
        version: "0.0.1-preview.feat-x.abc1234",
        unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
      },
      {
        "preview/feat-x": {
          name: "unvibe",
          version: "0.0.1-preview.feat-x.abc1234",
          unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
        },
      },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    expect(runner.calls.filter((c) => c.cmd === "npm" && c.opts.args[0] === "install")).toHaveLength(1);
    expect(runner.calls.find((c) => c.cmd === "npm")?.opts.args).toEqual([
      "install",
      "-g",
      "github:indigoviolet/unvibe#preview/feat-x",
    ]);
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("release-db");
    // The live database stays in place for the new build; no target slot is created.
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.existsSync(channelSlotDir(dataDir, "preview/feat-x"))).toBe(false);
    expect(out.lines.some((l) => l.includes("0.0.1-preview.feat-x.abc1234") && l.includes("(was 0.0.1)"))).toBe(true);
    expect(out.lines.some((l) => l.includes("backed up unvibe.db to"))).toBe(true);
    expect(out.lines.some((l) => l.includes("data kept (backed up to"))).toBe(true);
    expect(out.lines.some((l) => l.includes("Switching keeps your data"))).toBe(true);
    expect(out.lines.some((l) => l.includes("unvibe start"))).toBe(true);
  });

  it("pins --prefix to this binary's own prefix", async () => {
    const dataDir = tmpDir("unvibe-pin-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath, packagePath, prefix } = makePrefixedInstall(tmpDir("unvibe-pin-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new SwitchRunner(
      packagePath,
      { name: "unvibe", version: "0.0.1-preview.feat-x.abc1234", unvibe: { channel: "preview/feat-x" } },
      { "preview/feat-x": { name: "unvibe", version: "0.0.1-preview.feat-x.abc1234" } },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
    );
    expect(out.code).toBe(0);
    expect(runner.calls.find((c) => c.cmd === "npm")?.opts.args).toEqual([
      "install",
      "-g",
      "github:indigoviolet/unvibe#preview/feat-x",
      "--prefix",
      prefix,
    ]);
    expect(out.lines.some((l) => l.includes(`prefix ${prefix}`))).toBe(true);
  });

  it("fails naming the path and npm prefix when the install lands elsewhere", async () => {
    const dataDir = tmpDir("unvibe-elsewhere-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-elsewhere-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    // npm "succeeds" but our package is untouched: it went to another prefix.
    const runner = new SwitchRunner(
      packagePath,
      null,
      {
        "preview/feat-x": {
          name: "unvibe",
          version: "0.0.1-preview.feat-x.abc1234",
          unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
        },
      },
      "/other/prefix",
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
    );
    expect(out.code).toBe(1);
    expect(out.lines.some((l) => l.includes(packagePath) && l.includes("npm installed elsewhere"))).toBe(true);
    expect(out.lines.some((l) => l.includes("npm prefix -g: /other/prefix"))).toBe(true);
    // The live database stays in place on a miss; the pre-switch backup was still taken.
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("release-db");
  });

  it("preview -> preview with no release backup installs and keeps the data", async () => {
    // The reported failure (#36): first install was a preview, so no
    // release slot exists. The switch must proceed, keeping the live DB.
    const dataDir = tmpDir("unvibe-seedflow-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-a-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-seedflow-installed-"), {
      name: "unvibe",
      version: "0.0.1-preview.a.1111111",
      unvibe: { channel: "preview/a", commit: "1111111full" },
    });

    const runner = new SwitchRunner(
      packagePath,
      { name: "unvibe", version: "0.0.1-preview.b.2222222", unvibe: { channel: "preview/b", commit: "2222222full" } },
      {
        "preview/b": {
          name: "unvibe",
          version: "0.0.1-preview.b.2222222",
          unvibe: { channel: "preview/b", commit: "2222222full" },
        },
      },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0" },
      "preview/b",
    );
    expect(out.code).toBe(0);
    expect(runner.calls.filter((c) => c.cmd === "npm" && c.opts.args[0] === "install")).toHaveLength(1);
    // The live database carries over; the channel being left is backed up first.
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("preview-a-db");
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "preview/a"), "unvibe.db"), "utf8")).toBe("preview-a-db");
    expect(out.lines.some((l) => l.includes("data kept (backed up to"))).toBe(true);
  });

  it("restoreBackupOf restores the pre-switch backup after the install (rollback)", async () => {
    const dataDir = tmpDir("unvibe-rollback-restore-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "pre-switch-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-rollback-restore-installed-"), {
      name: "unvibe",
      version: "0.0.1-preview.b.2222222",
      unvibe: { channel: "preview/b", commit: "2222222full" },
    });
    // The forward switch backed up preview/a before installing preview/b;
    // preview/b has since (possibly) migrated the live database.
    backupChannel(dataDir, "preview/a");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "migrated-by-b");

    const runner = new SwitchRunner(
      packagePath,
      { name: "unvibe", version: "0.0.1-preview.a.1111111", unvibe: { channel: "preview/a", commit: "1111111full" } },
      {
        "preview/a": {
          name: "unvibe",
          version: "0.0.1-preview.a.1111111",
          unvibe: { channel: "preview/a", commit: "1111111full" },
        },
      },
    );
    const result = await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0",
      channel: "preview/a",
      restoreBackupOf: "preview/a",
      log: () => {},
    });
    expect(result.code).toBe(0);
    // The old build reopens its pre-switch database, not the migrated one.
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("pre-switch-db");
  });

  it("rolling back a same-channel update restores the pre-switch backup instead of overwriting it", async () => {
    const dataDir = tmpDir("unvibe-rollback-same-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "pre-switch-db");
    backupChannel(dataDir, "preview/a");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "migrated-by-new-a");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-rollback-same-installed-"), {
      name: "unvibe",
      version: "0.0.1-preview.a.2222222",
      unvibe: { channel: "preview/a", commit: "2222222full" },
    });
    const published = {
      name: "unvibe",
      version: "0.0.1-preview.a.3333333",
      unvibe: { channel: "preview/a", commit: "3333333full" },
    };
    const runner = new SwitchRunner(packagePath, published, { "preview/a": published });
    const result = await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0",
      channel: "preview/a",
      restoreBackupOf: "preview/a",
      log: () => {},
    });
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "preview/a"), "unvibe.db"), "utf8")).toBe("pre-switch-db");
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("pre-switch-db");
  });

  it("keeps the live database when leaving release for a target with no backup", async () => {
    const dataDir = tmpDir("unvibe-nobackup-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-nobackup-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new SwitchRunner(
      packagePath,
      {
        name: "unvibe",
        version: "0.0.1-preview.other.abc1234",
        unvibe: { channel: "preview/other", commit: "abc1234full" },
      },
      {
        "preview/other": {
          name: "unvibe",
          version: "0.0.1-preview.other.abc1234",
          unvibe: { channel: "preview/other", commit: "abc1234full" },
        },
      },
    );
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/other",
    );
    expect(out.code).toBe(0);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("release-db");
    expect(out.lines.some((l) => l.includes("data kept (backed up to"))).toBe(true);
  });

  it("leaves the database untouched when npm fails", async () => {
    const dataDir = tmpDir("unvibe-npmfail-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath } = makeInstall(tmpDir("unvibe-npmfail-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: contentsStdout({ name: "unvibe", version: "0.0.1-preview.feat-x.abc1234" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "npm", stdout: "", stderr: "network down", code: 1 });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
    );
    expect(out.code).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    // The backup is written before the install, so the pre-switch copy survives the failure.
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("release-db");
  });
});
