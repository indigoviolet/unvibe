/**
 * Manager-aware start/stop/status (issue #108, follow-up).
 *
 * Stubbed command runner + fake HOME + fake probes. The ownership rule
 * under test: with the unit installed, control goes through the service
 * manager (never a direct SIGTERM/spawn); without it, today's pid-based
 * behaviour is byte-for-byte identical.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLock, removeLock, removeOwnLock, writeLock } from "../src/cli/lock.js";
import { cliEnsureRunning, cliStart, cliStatus, cliStop, type CliDeps } from "../src/cli/managed-cli.js";
import { loginUnitPath } from "../src/update/service-manager.js";

const LIVE_PID = 424242;
const PORT = 4599;

function stubRunner(results: Record<string, number> = {}): { run: CliDeps["runner"]["run"]; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      const code = results[cmd] ?? 0;
      return { code, stdout: "", stderr: code === 0 ? "" : "no session" };
    },
  };
}

interface DepsOpts {
  platform?: string;
  managed?: boolean;
  runner?: { run: CliDeps["runner"]["run"]; calls: string[] };
  healthy?: boolean;
  lockPid?: number | null;
}

/** CliDeps with real lock files in a temp data dir and fake everything else. */
function deps(o: DepsOpts = {}): {
  d: CliDeps;
  home: string;
  dataDir: string;
  lines: string[];
  errs: string[];
  kills: string[];
  spawns: number[];
  runner: { calls: string[] };
} {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-home-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));
  const lines: string[] = [];
  const errs: string[] = [];
  const kills: string[] = [];
  const spawns: number[] = [];
  const runner = o.runner ?? stubRunner();
  if (o.managed) {
    const unit = loginUnitPath(home, o.platform ?? "linux");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, "unit");
  }
  if (o.lockPid !== undefined && o.lockPid !== null) {
    writeLock(dataDir, { pid: o.lockPid, port: PORT, startedAt: "2026-01-01T00:00:00.000Z" });
  }
  const healthy = o.healthy ?? false;
  let now = 1_000_000;
  const d: CliDeps = {
    homeDir: home,
    platform: o.platform ?? "linux",
    uid: 501,
    runner,
    dataDir,
    port: PORT,
    token: "tok",
    cliScriptPath: "/x/cli.js",
    readLock: (dir) => readLock(dir),
    removeLock: (dir) => removeLock(dir),
    removeOwnLock: (dir, pid) => removeOwnLock(dir, pid),
    isPidAlive: (pid) => pid === LIVE_PID,
    isHealthOk: async () => healthy,
    waitForHealth: async () => healthy,
    kill: (pid, signal) => {
      kills.push(`${signal} ${pid}`);
    },
    spawnDetached: async () => {
      spawns.push(1);
      return 777001;
    },
    serveForeground: async () => {
      throw new Error("serveForeground must not run here");
    },
    log: (l) => lines.push(l),
    err: (l) => errs.push(l),
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  };
  return { d, home, dataDir, lines, errs, kills, spawns, runner };
}

describe("cliStop", () => {
  it("unmanaged without a lock reports not running", async () => {
    const { d, lines, kills, runner } = deps();
    expect(await cliStop(d)).toBe(0);
    expect(lines).toEqual(["not running"]);
    expect(kills).toEqual([]);
    expect(runner.calls).toEqual([]);
  });

  it("unmanaged with a live lock SIGTERMs then SIGKILLs the pid (today's behaviour)", async () => {
    const { d, lines, kills } = deps({ lockPid: LIVE_PID });
    expect(await cliStop(d)).toBe(0);
    // The fake pid never dies, so the legacy path escalates exactly as today.
    expect(kills).toEqual([`SIGTERM ${LIVE_PID}`, `SIGKILL ${LIVE_PID}`]);
    expect(lines).toEqual(["stopped"]);
  });

  it("managed stop goes through the manager, never SIGTERM", async () => {
    for (const platform of ["darwin", "linux"]) {
      const { d, lines, kills, runner } = deps({ platform, managed: true, lockPid: LIVE_PID });
      expect(await cliStop(d)).toBe(0);
      expect(kills).toEqual([]);
      expect(runner.calls).toEqual(
        platform === "darwin"
          ? ["launchctl bootout gui/501/com.unvibe.service"]
          : ["systemctl --user stop unvibe.service"],
      );
      expect(lines).toEqual(["stopped"]);
    }
  });

  it("managed stop falls back to the pid stop when the service keeps answering", async () => {
    const { d, lines, kills, runner } = deps({ managed: true, lockPid: LIVE_PID, healthy: true });
    expect(await cliStop(d)).toBe(0);
    expect(runner.calls).toEqual(["systemctl --user stop unvibe.service"]);
    expect(kills).toContain(`SIGTERM ${LIVE_PID}`);
    expect(lines).toContain("stopped");
  });
});

describe("cliStart", () => {
  it("reuses a live lock without touching the manager", async () => {
    const { d, lines, runner } = deps({ managed: true, lockPid: LIVE_PID, healthy: true });
    expect(await cliStart(d, [])).toBe(0);
    expect(runner.calls).toEqual([]);
    expect(lines[0]).toContain("http://unvibe.localhost:4599/?token=tok");
    expect(lines[1]).toContain(`already running (pid ${LIVE_PID})`);
  });

  it("managed macOS start bootstraps through launchd", async () => {
    const { d, lines, runner } = deps({ platform: "darwin", managed: true, healthy: true });
    expect(await cliStart(d, [])).toBe(0);
    expect(runner.calls.length).toBe(1);
    expect(runner.calls[0]).toContain("launchctl bootstrap gui/501");
    expect(lines[0]).toContain("http://unvibe.localhost:4599/?token=tok");
  });

  it("managed macOS start kickstarts when already loaded but down", async () => {
    let n = 0;
    const runner = stubRunner();
    const orig = runner.run;
    runner.run = async (cmd: string, args: string[]) => {
      n += 1;
      const out = await orig(cmd, args);
      if (n === 1) return { code: 37, stdout: "", stderr: "already bootstrapped" };
      return out;
    };
    const { d, lines } = deps({ platform: "darwin", managed: true, healthy: true, runner });
    expect(await cliStart(d, [])).toBe(0);
    expect(runner.calls).toEqual([
      expect.stringContaining("launchctl bootstrap"),
      "launchctl kickstart gui/501/com.unvibe.service",
    ]);
    expect(lines.join("\n")).toContain("http://unvibe.localhost:4599/?token=tok");
  });

  it("managed Linux start uses systemctl", async () => {
    const { d, lines, runner } = deps({ managed: true, healthy: true });
    expect(await cliStart(d, [])).toBe(0);
    expect(runner.calls).toEqual(["systemctl --user start unvibe.service"]);
    expect(lines[0]).toContain("http://unvibe.localhost:4599/?token=tok");
  });

  it("a manager start that never answers unloads again and fails loudly", async () => {
    const { d, errs, spawns, runner } = deps({ managed: true, healthy: false });
    const code = await cliStart(d, []);
    expect(code).toBe(1);
    // Unloaded after the failed start (no crash-loop), then legacy spawn tried.
    expect(runner.calls).toContain("systemctl --user stop unvibe.service");
    expect(spawns).toEqual([1]);
    expect(errs.join("\n")).toContain("did not answer");
  });

  it("unmanaged start spawns directly (today's behaviour)", async () => {
    const { d, lines, spawns, runner } = deps({ healthy: true });
    expect(await cliStart(d, [])).toBe(0);
    expect(runner.calls).toEqual([]);
    expect(spawns).toEqual([1]);
    expect(lines[0]).toContain("http://unvibe.localhost:4599/?token=tok");
  });
});

describe("cliStatus", () => {
  it("names login management when running and when down", async () => {
    const up = deps({ managed: true, lockPid: LIVE_PID, healthy: true });
    expect(await cliStatus(up.d)).toBe(0);
    expect(up.lines[0]).toContain("starts at login");

    const down = deps({ managed: true });
    expect(await cliStatus(down.d)).toBe(1);
    expect(down.lines).toEqual(["not running (starts at login; start it with: unvibe start)"]);
  });

  it("unmanaged status is today's text", async () => {
    const up = deps({ lockPid: LIVE_PID, healthy: true });
    expect(await cliStatus(up.d)).toBe(0);
    expect(up.lines[0]).not.toContain("starts at login");

    const down = deps({});
    expect(await cliStatus(down.d)).toBe(1);
    expect(down.lines).toEqual(["not running (start it with: unvibe start)"]);
  });
});

describe("cliEnsureRunning", () => {
  it("reuses a live lock", async () => {
    const { d, runner } = deps({ managed: true, lockPid: LIVE_PID });
    const r = await cliEnsureRunning(d);
    expect(r).toEqual({ port: PORT, token: "tok", fresh: false });
    expect(runner.calls).toEqual([]);
  });

  it("starts through the manager when managed", async () => {
    const { d, runner } = deps({ managed: true, healthy: true });
    const r = await cliEnsureRunning(d);
    expect(r).toEqual({ port: PORT, token: "tok", fresh: true });
    expect(runner.calls).toEqual(["systemctl --user start unvibe.service"]);
  });
});
