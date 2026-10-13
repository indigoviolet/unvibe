/**
 * Start-at-login service management (issue #108, follow-up).
 *
 * Rule under test: when the login unit is installed ("managed"), process
 * control goes through the service manager; otherwise the CLI owns the
 * process directly. "Managed" is the unit file's presence under a home
 * dir — a fake HOME here, the real one at runtime.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkLoginUnit,
  isLoginManaged,
  kickstartServiceCommands,
  LAUNCHD_LABEL,
  launchdPlistContent,
  loginUnitPath,
  managedStatusText,
  parseLoginUnit,
  refreshLoginUnitIfManaged,
  startManagedService,
  startServiceCommands,
  stopManagedService,
  stopServiceCommands,
  SYSTEMD_UNIT_NAME,
  systemdUnitContent,
  unloadManagedService,
  type ManagerRunner,
} from "../src/update/service-manager.js";

function fakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-home-"));
}

function stubRunner(results: Record<string, number> = {}): ManagerRunner & { calls: string[] } {
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

const op = (runner: ManagerRunner, platform: string, home = "/home/u") => ({
  runner,
  log: () => {},
  platform,
  uid: 501,
  unitPath: loginUnitPath(home, platform),
});

describe("managed detection", () => {
  it("is the unit file's presence (darwin + linux)", () => {
    const home = fakeHome();
    expect(isLoginManaged(home, "darwin")).toBe(false);
    expect(isLoginManaged(home, "linux")).toBe(false);
    fs.mkdirSync(path.dirname(loginUnitPath(home, "darwin")), { recursive: true });
    fs.writeFileSync(loginUnitPath(home, "darwin"), "plist");
    expect(isLoginManaged(home, "darwin")).toBe(true);
    expect(isLoginManaged(home, "linux")).toBe(false);
    expect(loginUnitPath(home, "darwin")).toBe(
      path.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`),
    );
    expect(loginUnitPath(home, "linux")).toBe(path.join(home, ".config", "systemd", "user", SYSTEMD_UNIT_NAME));
  });

  it("names login management for status", () => {
    const home = fakeHome();
    expect(managedStatusText(home, "linux")).toBeNull();
    fs.mkdirSync(path.dirname(loginUnitPath(home, "linux")), { recursive: true });
    fs.writeFileSync(loginUnitPath(home, "linux"), "unit");
    expect(managedStatusText(home, "linux")).toBe("starts at login");
  });
});

describe("manager commands", () => {
  it("macOS stops via bootout (deliberate stop; crash-only restart leaves it down)", () => {
    expect(stopServiceCommands("darwin", 501)).toEqual([
      { cmd: "launchctl", args: ["bootout", "gui/501/com.unvibe.service"] },
    ]);
  });

  it("macOS starts via bootstrap, falling back to kickstart when already loaded", () => {
    expect(startServiceCommands("darwin", 501, "/home/u/plist")).toEqual([
      { cmd: "launchctl", args: ["bootstrap", "gui/501", "/home/u/plist"] },
    ]);
    expect(kickstartServiceCommands(501)).toEqual([
      { cmd: "launchctl", args: ["kickstart", "gui/501/com.unvibe.service"] },
    ]);
  });

  it("Linux stops/starts via systemctl --user", () => {
    expect(stopServiceCommands("linux", 501)).toEqual([
      { cmd: "systemctl", args: ["--user", "stop", "unvibe.service"] },
    ]);
    expect(startServiceCommands("linux", 501, "/home/u/unit")).toEqual([
      { cmd: "systemctl", args: ["--user", "start", "unvibe.service"] },
    ]);
  });

  it("no login uid means no macOS commands (caller falls back)", () => {
    expect(stopServiceCommands("darwin", null)).toEqual([]);
    expect(startServiceCommands("darwin", null, "/home/u/plist")).toEqual([]);
    expect(kickstartServiceCommands(null)).toEqual([]);
  });
});

describe("stopManagedService", () => {
  it("boots out on macOS and reports success", async () => {
    const runner = stubRunner();
    const lines: string[] = [];
    const ok = await stopManagedService({ ...op(runner, "darwin"), log: (l) => lines.push(l) });
    expect(ok).toBe(true);
    expect(runner.calls).toEqual(["launchctl bootout gui/501/com.unvibe.service"]);
    expect(lines).toEqual([]);
  });

  it("stops via systemctl on Linux", async () => {
    const runner = stubRunner();
    const ok = await stopManagedService(op(runner, "linux"));
    expect(ok).toBe(true);
    expect(runner.calls).toEqual(["systemctl --user stop unvibe.service"]);
  });

  it("failure is reported with a warning, never thrown", async () => {
    const runner = stubRunner({ launchctl: 1 });
    const lines: string[] = [];
    const ok = await stopManagedService({ ...op(runner, "darwin"), log: (l) => lines.push(l) });
    expect(ok).toBe(false);
    expect(lines.join("\n")).toContain("warning: launchctl bootout");
  });
});

describe("startManagedService", () => {
  it("bootstraps on macOS", async () => {
    const runner = stubRunner();
    const ok = await startManagedService(op(runner, "darwin", "/home/u"));
    expect(ok).toBe(true);
    expect(runner.calls).toEqual([
      `launchctl bootstrap gui/501 ${loginUnitPath("/home/u", "darwin")}`,
    ]);
  });

  it("falls back to kickstart when bootstrap fails (already loaded)", async () => {
    let n = 0;
    const runner: ManagerRunner & { calls: string[] } = {
      calls: [],
      run: async (cmd: string, args: string[]) => {
        runner.calls.push(`${cmd} ${args.join(" ")}`);
        n += 1;
        return n === 1 ? { code: 37, stdout: "", stderr: "already bootstrapped" } : { code: 0, stdout: "", stderr: "" };
      },
    };
    const lines: string[] = [];
    const ok = await startManagedService({ ...op(runner, "darwin"), log: (l) => lines.push(l) });
    expect(ok).toBe(true);
    expect(runner.calls).toEqual([
      expect.stringContaining("launchctl bootstrap"),
      "launchctl kickstart gui/501/com.unvibe.service",
    ]);
    expect(lines.join("\n")).toContain("already bootstrapped");
  });

  it("starts via systemctl on Linux", async () => {
    const runner = stubRunner();
    const ok = await startManagedService(op(runner, "linux"));
    expect(ok).toBe(true);
    expect(runner.calls).toEqual(["systemctl --user start unvibe.service"]);
  });

  it("both failing reports false (caller falls back to a direct spawn)", async () => {
    const runner = stubRunner({ launchctl: 1 });
    const ok = await startManagedService(op(runner, "darwin"));
    expect(ok).toBe(false);
  });
});

describe("unloadManagedService", () => {
  it("unloads after a failed start so a broken job cannot crash-loop", async () => {
    const runner = stubRunner();
    await unloadManagedService(op(runner, "darwin"));
    expect(runner.calls).toEqual(["launchctl bootout gui/501/com.unvibe.service"]);
    const runner2 = stubRunner();
    await unloadManagedService(op(runner2, "linux"));
    expect(runner2.calls).toEqual(["systemctl --user stop unvibe.service"]);
  });
});

describe("parseLoginUnit (Q2 round-trip against the builders)", () => {
  const OPTS = { nodePath: "/usr/bin/node", cliPath: "/x/cli.js", port: 4517, dataDir: "/home/u/.local/share/unvibe" };

  it("reads back a generated plist", () => {
    expect(parseLoginUnit(launchdPlistContent(OPTS), "darwin")).toEqual(OPTS);
  });

  it("reads back a generated systemd unit, including quoted paths", () => {
    expect(parseLoginUnit(systemdUnitContent(OPTS), "linux")).toEqual(OPTS);
    const spacy = { ...OPTS, nodePath: "/home/u/My Tools/node", dataDir: "/home/u/My Data" };
    expect(parseLoginUnit(systemdUnitContent(spacy), "linux")).toEqual(spacy);
  });

  it("rejects foreign content", () => {
    expect(parseLoginUnit("nonsense", "darwin")).toBeNull();
    expect(parseLoginUnit("nonsense", "linux")).toBeNull();
    expect(parseLoginUnit(launchdPlistContent(OPTS), "linux")).toBeNull();
  });
});

describe("checkLoginUnit (Q2 staleness)", () => {
  it("unmanaged is clean", () => {
    const home = fakeHome();
    expect(checkLoginUnit(home, "linux")).toEqual({
      managed: false,
      unitPath: loginUnitPath(home, "linux"),
      problems: [],
    });
  });

  it("fresh unit is clean; moved node/cli are reported with the fix", () => {
    const home = fakeHome();
    const unit = loginUnitPath(home, "linux");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(
      unit,
      systemdUnitContent({ nodePath: "/nonexistent/node", cliPath: "/nonexistent/cli.js", port: 4517, dataDir: home }),
    );
    const checked = checkLoginUnit(home, "linux");
    expect(checked.managed).toBe(true);
    expect(checked.problems).toHaveLength(2);
    expect(checked.problems.join("\n")).toContain("re-run `unvibe setup`");
  });
});

describe("refreshLoginUnitIfManaged (Q2)", () => {
  it("no-op when unmanaged", () => {
    const home = fakeHome();
    const written: string[] = [];
    const ok = refreshLoginUnitIfManaged(
      home,
      "linux",
      { nodePath: "/n", cliPath: "/c", port: 1, dataDir: home },
      (p, c) => {
        written.push(p, c);
      },
    );
    expect(ok).toBe(false);
    expect(written).toEqual([]);
  });

  it("rewrites a managed unit with fresh paths", () => {
    const home = fakeHome();
    const unit = loginUnitPath(home, "linux");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(
      unit,
      systemdUnitContent({ nodePath: "/old/node", cliPath: "/old/cli.js", port: 4517, dataDir: home }),
    );
    const ok = refreshLoginUnitIfManaged(home, "linux", {
      nodePath: "/new/node",
      cliPath: "/new/cli.js",
      port: 4599,
      dataDir: home,
    });
    expect(ok).toBe(true);
    expect(parseLoginUnit(fs.readFileSync(unit, "utf8"), "linux")).toEqual({
      nodePath: "/new/node",
      cliPath: "/new/cli.js",
      port: 4599,
      dataDir: home,
    });
  });
});
