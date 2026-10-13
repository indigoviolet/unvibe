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
  isLoginManaged,
  kickstartServiceCommands,
  LAUNCHD_LABEL,
  loginUnitPath,
  managedStatusText,
  startManagedService,
  startServiceCommands,
  stopManagedService,
  stopServiceCommands,
  SYSTEMD_UNIT_NAME,
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
