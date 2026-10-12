/**
 * `unvibe update` (issue #36, step 1): channel listing parsing (incl.
 * per-ref metadata without cloning), the install command built for a
 * channel, and the DB backup/restore rules against a temp data dir. No
 * network, no real gh/git/npm: `gh` and `npm` go through the injectable
 * command runner (faked here).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeLock } from "../src/cli/lock.js";
import { runUpdateChannelFlow, runUpdateListFlow } from "../src/cli/update-flows.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/runner.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  backupChannel,
  channelSlotDir,
  hasBackup,
  restoreChannel,
} from "../src/update/data-backup.js";
import {
  channelKind,
  decodeRefPackage,
  formatChannelList,
  isChannelName,
  listChannels,
  parseChannelList,
  readInstalledBuild,
} from "../src/update/channels.js";
import { installRef, installSpec } from "../src/update/install.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Fake install tree: <root>/package.json + a CLI script path inside it. */
function makeInstall(root: string, pkg: unknown): { scriptPath: string; packagePath: string } {
  const packagePath = path.join(root, "package.json");
  fs.mkdirSync(path.join(root, "packages", "service", "dist"), { recursive: true });
  fs.writeFileSync(packagePath, JSON.stringify(pkg));
  const scriptPath = path.join(root, "packages", "service", "dist", "index.js");
  fs.writeFileSync(scriptPath, "");
  return { scriptPath, packagePath };
}

/** `gh api .../contents/package.json` response body for a package. */
function contentsStdout(pkg: unknown): string {
  return JSON.stringify({
    content: Buffer.from(JSON.stringify(pkg)).toString("base64"),
    encoding: "base64",
  });
}

describe("channel names + install specs", () => {
  it("accepts release, release-rc and preview/* only", () => {
    expect(isChannelName("release")).toBe(true);
    expect(isChannelName("release-rc")).toBe(true);
    expect(isChannelName("preview/feat-x")).toBe(true);
    expect(isChannelName("preview/a.b_c-d")).toBe(true);
    for (const bad of ["", "main", "preview/", "preview/a/b", "preview/../x", "Release", "Preview/x"]) {
      expect(isChannelName(bad), bad).toBe(false);
    }
  });

  it("maps refs to kinds", () => {
    expect(channelKind("release")).toBe("release");
    expect(channelKind("release-rc")).toBe("release-rc");
    expect(channelKind("preview/feat-x")).toBe("preview");
  });

  it("builds the npm install spec for a channel", () => {
    expect(installSpec("release")).toBe("github:indigoviolet/unvibe#release");
    expect(installSpec("release-rc")).toBe("github:indigoviolet/unvibe#release-rc");
    expect(installSpec("preview/feat-x")).toBe("github:indigoviolet/unvibe#preview/feat-x");
    expect(() => installSpec("main")).toThrow();
  });

  it("installs the channel ref globally through the runner", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "npm", stdout: "added 1 package", stderr: "", code: 0 });
    const res = await installRef(runner, "preview/feat-x");
    expect(res.code).toBe(0);
    expect(runner.calls).toEqual([
      { cmd: "npm", opts: { args: ["install", "-g", "github:indigoviolet/unvibe#preview/feat-x"] } },
    ]);
    await expect(installRef(runner, "main")).rejects.toThrow();
  });

  it("parses gh branch output into sorted, deduped channels", () => {
    const out = parseChannelList(
      ["release", "main", "preview/b", "release-rc", "preview/a", "preview/b", "", "  "].join("\n"),
    );
    expect(out).toEqual(["release", "release-rc", "preview/a", "preview/b"]);
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
    },
  };

  it("decodes a gh contents response into version + provenance", () => {
    expect(decodeRefPackage(contentsStdout(previewPkg))).toEqual({
      version: "0.0.1-preview.feat-x.abc1234",
      commit: "abc1234full",
      sourceBranch: "feat/x",
      builtAt: "2026-10-12T00:50:12.402Z",
    });
  });

  it("returns nulls for unreadable responses (old builds without metadata stay listed)", () => {
    const blank = { version: null, commit: null, sourceBranch: null, builtAt: null };
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
    const channels = await listChannels(runner, {
      version: "0.0.1",
      channel: "release",
      sourceBranch: null,
      commit: null,
      builtAt: null,
      packagePath: null,
    });
    expect(channels).toEqual([
      {
        ref: "release",
        kind: "release",
        version: "0.0.1",
        commit: null,
        sourceBranch: null,
        builtAt: null,
        current: true,
      },
      {
        ref: "preview/feat-x",
        kind: "preview",
        version: "0.0.1-preview.feat-x.abc1234",
        commit: "abc1234full",
        sourceBranch: "feat/x",
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
    const channels = await listChannels(runner, {
      version: "0",
      channel: null,
      sourceBranch: null,
      commit: null,
      builtAt: null,
      packagePath: null,
    });
    expect(channels).toEqual([
      {
        ref: "release",
        kind: "release",
        version: null,
        commit: null,
        sourceBranch: null,
        builtAt: null,
        current: false,
      },
    ]);
  });

  it("throws when the branch list itself fails", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "auth failed", code: 1 });
    await expect(
      listChannels(runner, {
        version: "0",
        channel: null,
        sourceBranch: null,
        commit: null,
        builtAt: null,
        packagePath: null,
      }),
    ).rejects.toThrow(/gh exited 1/);
  });

  it("formats the list with versions and provenance", () => {
    const lines = formatChannelList(
      [
        { ref: "release", kind: "release", version: "0.0.1", commit: null, sourceBranch: null, builtAt: null, current: true },
        { ref: "preview/feat-x", kind: "preview", version: "0.0.1-preview.feat-x.abc1234", commit: "abc1234full", sourceBranch: "feat/x", builtAt: "2026-10-12T00:50:12.402Z", current: false },
        { ref: "preview/gone", kind: "preview", version: null, commit: null, sourceBranch: null, builtAt: null, current: false },
      ],
      { version: "0.0.1", channel: "release", sourceBranch: null, commit: null, builtAt: null, packagePath: null },
    );
    expect(lines).toContain("* release (installed, 0.0.1)");
    expect(lines).toContain("  preview/feat-x (0.0.1-preview.feat-x.abc1234)");
    expect(lines).toContain("    from feat/x @ abc1234, built 2026-10-12");
    expect(lines).toContain("  preview/gone (metadata unavailable)");
    expect(lines[lines.length - 1]).toMatch(/unvibe update <channel>/);
  });
});

describe("readInstalledBuild", () => {
  it("reads version + channel + provenance from the installed package.json", () => {
    const root = tmpDir("unvibe-installed-");
    const { scriptPath, packagePath } = makeInstall(root, {
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
      commit: "abc1234full",
      builtAt: "2026-10-12T00:50:12.402Z",
      packagePath,
    });
  });

  it("resolves the global bin symlink to the installed package", () => {
    const root = tmpDir("unvibe-installed-link-");
    const { scriptPath } = makeInstall(root, {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x" },
    });
    // <prefix>/bin/unvibe -> ../lib/node_modules/unvibe/.../index.js, as npm lays it out.
    const binDir = path.join(root, "prefix", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, "unvibe");
    fs.symlinkSync(scriptPath, link);
    const got = readInstalledBuild(link, "fallback");
    expect(got.channel).toBe("preview/feat-x");
    expect(got.version).toBe("0.0.1-preview.feat-x.abc1234");
  });

  it("falls back cleanly without metadata, garbage, or package", () => {
    const root = tmpDir("unvibe-installed-old-");
    const plain = makeInstall(root, { name: "unvibe", version: "0.0.1" });
    const got = readInstalledBuild(plain.scriptPath, "fallback");
    expect(got.channel).toBeNull();
    expect(got.version).toBe("0.0.1");
    expect(got.commit).toBeNull();

    const garbage = makeInstall(tmpDir("unvibe-installed-garbage-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "main" },
    });
    expect(readInstalledBuild(garbage.scriptPath, "fallback").channel).toBeNull();

    expect(readInstalledBuild(undefined, "fallback")).toEqual({
      version: "fallback",
      channel: null,
      sourceBranch: null,
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
    expect(hasBackup(dataDir, "release")).toBe(true);
    expect(hasBackup(dataDir, "preview/feat-x")).toBe(false);
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
    // Simulate life on a preview: live files diverge, preview slot exists.
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-db");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-wal"), "stale-wal");
    backupChannel(dataDir, "preview/feat-x");
    // Switch back: stale wal must not shadow the restored main file.
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "preview-db-2");
    fs.writeFileSync(path.join(dataDir, "unvibe.db-wal"), "stale-wal-2");
    const restored = restoreChannel(dataDir, "release");
    expect(restored.files).toEqual(["unvibe.db"]);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.existsSync(path.join(dataDir, "unvibe.db-wal"))).toBe(false);
    // The preview slot survived the restore.
    expect(hasBackup(dataDir, "preview/feat-x")).toBe(true);
  });

  it("handles the legacy unvibe.sqlite name when present", () => {
    const dataDir = tmpDir("unvibe-legacy-");
    fs.writeFileSync(path.join(dataDir, "unvibe.sqlite"), "legacy");
    const res = backupChannel(dataDir, "release");
    expect(res.files).toContain("unvibe.sqlite");
    expect(hasBackup(dataDir, "release")).toBe(true);
  });

  it("backs up nothing on a fresh machine, without failing", () => {
    const dataDir = tmpDir("unvibe-fresh-");
    const res = backupChannel(dataDir, "release");
    expect(res.files).toEqual([]);
    expect(hasBackup(dataDir, "release")).toBe(false);
  });
});

/** Runner that simulates a real `npm install -g` by rewriting package.json. */
class ReinstallRunner implements CommandRunner {
  readonly calls: { cmd: string; opts: RunOptions }[] = [];
  constructor(
    private packagePath: string,
    private nextPkg: unknown,
  ) {}
  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    this.calls.push({ cmd, opts });
    if (cmd === "npm") {
      fs.writeFileSync(this.packagePath, JSON.stringify(this.nextPkg));
      return { stdout: "added 1 package", stderr: "", code: 0 };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }
}

const BRANCHES = ["release", "release-rc", "preview/feat-x", "main"].join("\n");

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
    enqueueContents(runner, "release-rc", { name: "unvibe", version: "0.0.1-rc.2" });
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
    expect(out.lines).toContain("  release-rc (0.0.1-rc.2)");
    expect(out.lines).toContain("  preview/feat-x (0.0.1-preview.feat-x.abc1234)");
    expect(out.lines.some((l) => l.includes("main"))).toBe(false);
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
  });
});

describe("runUpdateChannelFlow", () => {
  it("rejects unknown channels without touching anything", async () => {
    const runner = new FakeCommandRunner();
    const out = await runUpdateChannelFlow(
      { runner, dataDir: tmpDir("unvibe-badchan-"), cliScriptPath: undefined, serviceVersion: "0" },
      "main",
      { keepData: false },
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
      { keepData: false },
    );
    expect(out.code).toBe(1);
    expect(out.lines.some((l) => l.includes("unvibe stop"))).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it("is a no-op when already on the channel", async () => {
    const { scriptPath } = makeInstall(tmpDir("unvibe-same-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    const out = await runUpdateChannelFlow(
      { runner, dataDir: tmpDir("unvibe-same-data-"), cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "release",
      { keepData: false },
    );
    expect(out.code).toBe(0);
    expect(out.lines[0]).toMatch(/already on release/);
    expect(runner.calls).toHaveLength(0);
  });

  it("backs up, installs the channel spec, restores the target copy, reports versions", async () => {
    const dataDir = tmpDir("unvibe-switch-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const root = tmpDir("unvibe-switch-installed-");
    const { scriptPath, packagePath } = makeInstall(root, {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    // A backup left from a previous visit to the preview.
    const slot = channelSlotDir(dataDir, "preview/feat-x");
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, "unvibe.db"), "preview-db");

    const runner = new ReinstallRunner(packagePath, {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234", builtAt: "2026-10-12", sourceBranch: "feat/x", sourceVersion: "0.0.1" },
    });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
      { keepData: false },
    );
    expect(out.code).toBe(0);
    // The install command is the literal global install for the channel.
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual({
      cmd: "npm",
      opts: { args: ["install", "-g", "github:indigoviolet/unvibe#preview/feat-x"] },
    });
    // Old channel backed up, target channel restored, versions reported.
    expect(fs.readFileSync(path.join(channelSlotDir(dataDir, "release"), "unvibe.db"), "utf8")).toBe("release-db");
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("preview-db");
    expect(out.lines.some((l) => l.includes("0.0.1-preview.feat-x.abc1234") && l.includes("(was 0.0.1)"))).toBe(true);
    expect(out.lines.some((l) => l.includes("restored unvibe.db"))).toBe(true);
    expect(out.lines.some((l) => l.includes("DB rule:"))).toBe(true);
    expect(out.lines.some((l) => l.includes("unvibe start"))).toBe(true);
  });

  it("--keep-data skips the restore but still backs up", async () => {
    const dataDir = tmpDir("unvibe-keep-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const root = tmpDir("unvibe-keep-installed-");
    const { scriptPath, packagePath } = makeInstall(root, {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const slot = channelSlotDir(dataDir, "preview/feat-x");
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, "unvibe.db"), "preview-db");

    const runner = new ReinstallRunner(packagePath, {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x" },
    });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
      { keepData: true },
    );
    expect(out.code).toBe(0);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(out.lines.some((l) => l.includes("--keep-data"))).toBe(true);
  });

  it("keeps the live database when the target has no backup yet", async () => {
    const dataDir = tmpDir("unvibe-nobackup-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const root = tmpDir("unvibe-nobackup-installed-");
    const { scriptPath, packagePath } = makeInstall(root, {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new ReinstallRunner(packagePath, {
      name: "unvibe",
      version: "0.0.1-preview.other.abc1234",
      unvibe: { channel: "preview/other" },
    });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/other",
      { keepData: false },
    );
    expect(out.code).toBe(0);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(out.lines.some((l) => l.includes("no backup for preview/other"))).toBe(true);
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
    runner.enqueue({ cmd: "npm", stdout: "", stderr: "network down", code: 1 });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1" },
      "preview/feat-x",
      { keepData: false },
    );
    expect(out.code).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(hasBackup(dataDir, "release")).toBe(true);
  });
});
