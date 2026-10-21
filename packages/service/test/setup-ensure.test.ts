/**
 * Setup-once-per-version (issue #42): the release package declares no
 * install scripts, so `unvibe start` must complete setup for the
 * running version — once, quietly, and never failing the start. Stub
 * runner, fake HOME, simulated platforms.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSetupForVersion, readSetupVersion, writeSetupVersion } from "../src/cli/setup/ensure.js";
import { desktopFilePath } from "../src/cli/setup/linux.js";
import { launchdPlistPath, systemdUnitPath } from "../src/cli/setup/login.js";
import { installSetup, type RunResult, type SetupRunner } from "../src/cli/setup/index.js";
import { readLock, removeLock, removeOwnLock } from "../src/cli/lock.js";
import { cliStart, type CliDeps } from "../src/cli/managed-cli.js";

function fakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ensure-"));
}

function stubRunner(): SetupRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async (cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

describe("ensureSetupForVersion (issue #42)", () => {
  function deps(home: string, over: Partial<Parameters<typeof ensureSetupForVersion>[0]> = {}) {
    const lines: string[] = [];
    const runner = stubRunner();
    return {
      lines,
      runner,
      dep: {
        version: "0.0.8",
        dataDir: path.join(home, ".local", "share", "unvibe"),
        port: 4517,
        homeDir: home,
        platform: "linux",
        paths: { homeDir: home, nodePath: "/usr/bin/node", cliPath: "/x/cli.js" },
        runner,
        ensureToken: () => {},
        log: (l: string) => lines.push(l),
        ...over,
      },
    };
  }

  it("runs setup once for a version, records it, then stays quiet", async () => {
    const home = fakeHome();
    const { dep, lines, runner } = deps(home);
    expect(await ensureSetupForVersion(dep)).toBe(true);
    expect(fs.existsSync(desktopFilePath(home))).toBe(true);
    expect(fs.existsSync(systemdUnitPath(home))).toBe(true);
    expect(readSetupVersion(dep.dataDir)).toBe("0.0.8");
    const callsAfterFirst = runner.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Same version: no setup, no output.
    expect(await ensureSetupForVersion(dep)).toBe(false);
    expect(runner.calls.length).toBe(callsAfterFirst);
    expect(lines).toEqual([]);

    // A new version runs it again.
    expect(await ensureSetupForVersion({ ...dep, version: "0.0.9" })).toBe(true);
    expect(readSetupVersion(dep.dataDir)).toBe("0.0.9");
  });

  it("a setup failure warns once, records nothing, and resolves (start must not fail)", async () => {
    const home = fakeHome();
    const failing: SetupRunner = { run: async () => ({ code: 1, stdout: "", stderr: "boom" }) };
    // Linux installSetup does not throw on runner failures, so force a
    // throw through the token step to cover the failure path.
    const { dep, lines } = deps(home, {
      runner: failing,
      ensureToken: () => {
        throw new Error("read-only");
      },
    });
    await expect(ensureSetupForVersion(dep)).resolves.toBe(false);
    expect(lines).toEqual(["setup has not run for this version yet; run `unvibe setup` to finish installing."]);
    expect(readSetupVersion(dep.dataDir)).toBeNull();
  });

  it("macOS: first start launches one generation; deferred setup never bootstraps a second", async () => {
    const home = fakeHome();
    const dataDir = path.join(home, ".local", "share", "unvibe");
    const calls: string[] = [];
    // Stub runner simulating macOS: osacompile writes the helper skeleton.
    const samplePlist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      "<dict>",
      "  <key>CFBundleName</key>",
      "  <string>Unvibe</string>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n");
    const runner: SetupRunner = {
      run: async (cmd: string, args: string[]): Promise<RunResult> => {
        calls.push(`${cmd} ${args.join(" ")}`);
        if (cmd === "osacompile") {
          const out = args[args.indexOf("-o") + 1];
          fs.mkdirSync(path.join(out, "Contents"), { recursive: true });
          fs.writeFileSync(path.join(out, "Contents", "Info.plist"), samplePlist);
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const spawns: number[] = [];
    const lines: string[] = [];
    let now = 1_000_000;
    const d: CliDeps = {
      homeDir: home,
      platform: "darwin",
      uid: 501,
      runner,
      dataDir,
      port: 4599,
      token: "tok",
      cliScriptPath: "/x/cli.js",
      readLock: (dir) => readLock(dir),
      removeLock: (dir) => removeLock(dir),
      removeOwnLock: (dir, pid) => removeOwnLock(dir, pid),
      isPidAlive: () => false,
      isHealthOk: async () => true,
      waitForHealth: async () => true,
      kill: () => {},
      spawnDetached: async () => {
        spawns.push(1);
        return 777001;
      },
      serveForeground: async () => {
        throw new Error("serveForeground must not run here");
      },
      log: (l) => lines.push(l),
      err: (l) => lines.push(l),
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    };
    // `unvibe start` order: start (no unit yet, direct spawn), then setup.
    expect(await cliStart(d, [])).toBe(0);
    expect(spawns).toEqual([1]);
    expect(calls.filter((c) => c.startsWith("launchctl"))).toEqual([]);
    expect(
      await ensureSetupForVersion({
        version: "0.0.8",
        dataDir,
        port: 4599,
        homeDir: home,
        platform: "darwin",
        paths: { homeDir: home, nodePath: "/usr/bin/node", cliPath: "/x/cli.js" },
        runner,
        ensureToken: () => {},
        log: (l) => lines.push(l),
      }),
    ).toBe(true);
    expect(fs.existsSync(launchdPlistPath(home))).toBe(true);
    expect(readSetupVersion(dataDir)).toBe("0.0.8");
    // The regression: setup's launchd bootstrap (RunAtLoad) started a
    // second generation beside the one `start` launched.
    expect(calls.filter((c) => c.includes("launchctl bootstrap"))).toEqual([]);
    expect(calls.filter((c) => c.includes("launchctl bootout"))).toEqual([]);
    expect(spawns).toEqual([1]);

    // Manual `unvibe setup` still enables login start immediately.
    const home2 = fakeHome();
    calls.length = 0;
    await installSetup({ homeDir: home2, nodePath: "/usr/bin/node", cliPath: "/x/cli.js" }, runner, "darwin", {
      port: 4599,
      dataDir: path.join(home2, "data"),
    });
    expect(calls.some((c) => c.includes("launchctl bootstrap"))).toBe(true);
  });

  it("write/read round-trips and tolerates a missing marker", () => {
    const home = fakeHome();
    const dataDir = path.join(home, "data");
    expect(readSetupVersion(dataDir)).toBeNull();
    writeSetupVersion(dataDir, "1.2.3");
    expect(readSetupVersion(dataDir)).toBe("1.2.3");
  });
});
