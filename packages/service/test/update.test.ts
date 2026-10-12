/**
 * `unvibe update` (issue #36, step 1): channel listing parsing, the install
 * command built for a channel, and the DB backup/restore rules against a
 * temp data dir. No network, no real gh/git/npm: `gh` and `npm` go through
 * the injectable command runner (faked here).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeLock } from "../src/cli/lock.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/runner.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import {
  backupChannel,
  channelSlotDir,
  hasBackup,
  restoreChannel,
} from "../src/update/backup.js";
import {
  formatChannelList,
  installSpec,
  isChannelName,
  parseChannelList,
  readInstalledBuild,
} from "../src/update/channels.js";
import { runUpdateList, runUpdateToChannel } from "../src/update/update.js";

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

  it("builds the npm install spec for a channel", () => {
    expect(installSpec("release")).toBe("github:indigoviolet/unvibe#release");
    expect(installSpec("release-rc")).toBe("github:indigoviolet/unvibe#release-rc");
    expect(installSpec("preview/feat-x")).toBe("github:indigoviolet/unvibe#preview/feat-x");
    expect(() => installSpec("main")).toThrow();
  });

  it("parses gh branch output into sorted, deduped channels", () => {
    const out = parseChannelList(
      ["release", "main", "preview/b", "release-rc", "preview/a", "preview/b", "", "  "].join("\n"),
    );
    expect(out).toEqual(["release", "release-rc", "preview/a", "preview/b"]);
  });

  it("marks the installed channel in --list output", () => {
    const lines = formatChannelList(["release", "release-rc", "preview/a"], {
      version: "0.0.1",
      channel: "release",
      packagePath: null,
    });
    expect(lines).toContain("* release (installed, 0.0.1)");
    expect(lines).toContain("  preview/a");
    expect(lines[lines.length - 1]).toMatch(/unvibe update <channel>/);
  });
});

describe("readInstalledBuild", () => {
  it("reads version + channel from the installed package.json", () => {
    const root = tmpDir("unvibe-installed-");
    const { scriptPath, packagePath } = makeInstall(root, {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x" },
    });
    expect(readInstalledBuild(scriptPath, "fallback")).toEqual({
      version: "0.0.1-preview.feat-x.abc1234",
      channel: "preview/feat-x",
      packagePath,
    });
  });

  it("falls back cleanly without metadata, garbage, or package", () => {
    const root = tmpDir("unvibe-installed-old-");
    const plain = makeInstall(root, { name: "unvibe", version: "0.0.1" });
    expect(readInstalledBuild(plain.scriptPath, "fallback").channel).toBeNull();
    expect(readInstalledBuild(plain.scriptPath, "fallback").version).toBe("0.0.1");

    const garbage = makeInstall(tmpDir("unvibe-installed-garbage-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "main" },
    });
    expect(readInstalledBuild(garbage.scriptPath, "fallback").channel).toBeNull();

    expect(readInstalledBuild(undefined, "fallback")).toEqual({
      version: "fallback",
      channel: null,
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

const GH_BRANCHES = ["release", "release-rc", "preview/feat-x", "main"].join("\n");

describe("runUpdateList", () => {
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
      stdout: GH_BRANCHES,
      stderr: "",
      code: 0,
    });
    const out = await runUpdateList({ runner, dataDir: tmpDir("unvibe-list-data-"), cliScriptPath: scriptPath });
    expect(out.code).toBe(0);
    expect(out.lines).toContain("* release (installed, 0.0.1)");
    expect(out.lines).toContain("  preview/feat-x");
    expect(out.lines.some((l) => l.includes("main"))).toBe(false);
    // gh ran with GITHUB_TOKEN unset (PRD §15).
    expect(runner.calls[0].opts.env?.["GITHUB_TOKEN"]).toBeUndefined();
  });

  it("reports gh failures with a fix hint", async () => {
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "auth failed", code: 1 });
    const out = await runUpdateList({ runner, dataDir: tmpDir("unvibe-list-fail-"), cliScriptPath: undefined });
    expect(out.code).toBe(1);
    expect(out.lines.some((l) => l.includes("gh auth login"))).toBe(true);
  });
});

describe("runUpdateToChannel", () => {
  it("rejects unknown channels without touching anything", async () => {
    const runner = new FakeCommandRunner();
    const out = await runUpdateToChannel(
      { runner, dataDir: tmpDir("unvibe-badchan-"), cliScriptPath: undefined },
      "main",
      { keepData: false },
    );
    expect(out.code).toBe(2);
    expect(runner.calls).toHaveLength(0);
  });

  it("refuses while the service runs, telling the user to stop first", async () => {
    const dataDir = tmpDir("unvibe-running-");
    writeLock(dataDir, { pid: process.pid, port: 4517, startedAt: "" });
    const runner = new FakeCommandRunner();
    const out = await runUpdateToChannel({ runner, dataDir, cliScriptPath: undefined }, "preview/feat-x", {
      keepData: false,
    });
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
    const out = await runUpdateToChannel({ runner, dataDir: tmpDir("unvibe-same-data-"), cliScriptPath: scriptPath }, "release", {
      keepData: false,
    });
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
    const out = await runUpdateToChannel({ runner, dataDir, cliScriptPath: scriptPath }, "preview/feat-x", {
      keepData: false,
    });
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
    const out = await runUpdateToChannel({ runner, dataDir, cliScriptPath: scriptPath }, "preview/feat-x", {
      keepData: true,
    });
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
    const out = await runUpdateToChannel({ runner, dataDir, cliScriptPath: scriptPath }, "preview/other", {
      keepData: false,
    });
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
    const out = await runUpdateToChannel({ runner, dataDir, cliScriptPath: scriptPath }, "preview/feat-x", {
      keepData: false,
    });
    expect(out.code).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
    expect(hasBackup(dataDir, "release")).toBe(true);
  });
});
