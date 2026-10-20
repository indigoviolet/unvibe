/**
 * npm postinstall setup guards (issue #42): the decision is pure and
 * injected (env, platform, home, uid, switch/service probes), so macOS,
 * root, CI and a running service are simulated from any host. The run
 * path uses the stub SetupRunner pattern from the setup tests: a fake
 * `osacompile` that writes a bundle skeleton, everything else recorded.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decidePostinstall,
  installedCliPath,
  isInstalledLayout,
  POSTINSTALL_HINT,
  runPostinstall,
  type PostinstallProbe,
} from "../src/cli/setup/postinstall.js";
import { desktopFilePath } from "../src/cli/setup/linux.js";
import { helperAppPath } from "../src/cli/setup/macos.js";
import { launchdPlistPath, systemdUnitPath } from "../src/cli/setup/login.js";
import type { RunResult, SetupRunner } from "../src/cli/setup/index.js";

const GLOBAL = { npm_config_global: "true" };

function probe(over: Partial<PostinstallProbe> = {}): PostinstallProbe {
  return {
    env: { ...GLOBAL },
    platform: "linux",
    homeDir: "/home/u",
    uid: 1000,
    switchPending: false,
    serviceRunning: false,
    inInstalledLayout: true,
    ...over,
  };
}

describe("decidePostinstall (issue #42)", () => {
  it("runs for a global install on macOS and Linux", () => {
    expect(decidePostinstall(probe({ platform: "darwin" }))).toEqual({ action: "run" });
    expect(decidePostinstall(probe({ platform: "linux" }))).toEqual({ action: "run" });
  });

  it("skips non-global and dev installs silently", () => {
    expect(decidePostinstall(probe({ env: {} }))).toMatchObject({ action: "skip", hint: false });
    expect(decidePostinstall(probe({ env: { npm_config_global: "false" } }))).toMatchObject({
      action: "skip",
      hint: false,
    });
  });

  it("skips as root with the manual-setup hint", () => {
    expect(decidePostinstall(probe({ uid: 0 }))).toMatchObject({ action: "skip", hint: true });
  });

  it("skips in CI with a hint, unless forced (the install check forces it)", () => {
    expect(decidePostinstall(probe({ env: { ...GLOBAL, CI: "true" } }))).toMatchObject({
      action: "skip",
      hint: true,
    });
    expect(decidePostinstall(probe({ env: { ...GLOBAL, CI: "true", UNVIBE_POSTINSTALL_SETUP: "1" } }))).toEqual({
      action: "run",
    });
    // Forcing does not override the root guard.
    expect(
      decidePostinstall(probe({ uid: 0, env: { ...GLOBAL, CI: "true", UNVIBE_POSTINSTALL_SETUP: "1" } })),
    ).toMatchObject({ action: "skip", hint: true });
  });

  it("forcing never bypasses the global check (npm git-dep preparation is non-global)", () => {
    expect(decidePostinstall(probe({ env: { UNVIBE_POSTINSTALL_SETUP: "1" } }))).toMatchObject({
      action: "skip",
      hint: false,
    });
  });

  it("honours the explicit opt-outs silently", () => {
    expect(decidePostinstall(probe({ env: { ...GLOBAL, UNVIBE_SKIP_POSTINSTALL_SETUP: "1" } }))).toMatchObject({
      action: "skip",
      hint: false,
    });
    expect(decidePostinstall(probe({ env: { ...GLOBAL, UNVIBE_POSTINSTALL_SETUP: "0" } }))).toMatchObject({
      action: "skip",
      hint: false,
    });
  });

  it("skips with a hint when there is no home or the platform is unsupported", () => {
    expect(decidePostinstall(probe({ homeDir: null }))).toMatchObject({ action: "skip", hint: true });
    expect(decidePostinstall(probe({ homeDir: "" }))).toMatchObject({ action: "skip", hint: true });
    expect(decidePostinstall(probe({ platform: "win32" }))).toMatchObject({ action: "skip", hint: true });
  });

  it("stays out of the update helper's way: pending switch or running service skip silently", () => {
    expect(decidePostinstall(probe({ switchPending: true }))).toMatchObject({ action: "skip", hint: false });
    expect(decidePostinstall(probe({ serviceRunning: true }))).toMatchObject({ action: "skip", hint: false });
  });

  it("skips in npm's git-preparation clone, which reports global but is not the install", () => {
    expect(decidePostinstall(probe({ inInstalledLayout: false }))).toMatchObject({ action: "skip", hint: false });
    expect(isInstalledLayout("/prefix/lib/node_modules/unvibe/packages/service/dist")).toBe(true);
    expect(isInstalledLayout("/tmp/cache/_cacache/tmp/git-cloneABC/packages/service/dist")).toBe(false);
    expect(isInstalledLayout("/home/u/src/unvibe/packages/service/dist")).toBe(false);
  });

  it("bakes the installed entry, not the lifecycle script path", () => {
    expect(installedCliPath("/prefix/lib/node_modules/unvibe/packages/service/dist")).toBe(
      "/prefix/lib/node_modules/unvibe/packages/service/dist/index.js",
    );
  });
});

const SAMPLE_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0">',
  "<dict>",
  "  <key>CFBundleName</key>",
  "  <string>Unvibe</string>",
  "</dict>",
  "</plist>",
  "",
].join("\n");

function stubRunner(): SetupRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async (cmd: string, args: string[]): Promise<RunResult> => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "osacompile") {
        const out = args[args.indexOf("-o") + 1];
        fs.mkdirSync(path.join(out, "Contents"), { recursive: true });
        fs.writeFileSync(path.join(out, "Contents", "Info.plist"), SAMPLE_PLIST);
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function fakeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-postinstall-"));
}

describe("runPostinstall (issue #42)", () => {
  function deps(home: string, platform: string, over: Partial<Parameters<typeof runPostinstall>[0]> = {}) {
    const lines: string[] = [];
    return {
      lines,
      dep: {
        ...probe({ platform, homeDir: home }),
        paths: { homeDir: home, nodePath: "/usr/bin/node", cliPath: "/x/cli.js" },
        port: 4517,
        dataDir: path.join(home, ".local", "share", "unvibe"),
        runner: stubRunner(),
        ensureToken: () => {},
        log: (l: string) => lines.push(l),
        ...over,
      },
    };
  }

  it("places the Linux handler and login unit, quietly, and is idempotent", async () => {
    const home = fakeHome();
    const { dep, lines } = deps(home, "linux");
    expect((await runPostinstall(dep)).action).toBe("run");
    expect(fs.existsSync(desktopFilePath(home))).toBe(true);
    expect(fs.existsSync(systemdUnitPath(home))).toBe(true);
    expect(fs.readFileSync(desktopFilePath(home), "utf8")).toContain("/x/cli.js");
    expect(lines).toEqual([]);
    // Reinstall/update: same result, still quiet.
    expect((await runPostinstall(dep)).action).toBe("run");
    expect(lines).toEqual([]);
  });

  it("places the macOS helper app and login unit (simulated platform)", async () => {
    const home = fakeHome();
    const { dep, lines } = deps(home, "darwin");
    expect((await runPostinstall(dep)).action).toBe("run");
    expect(fs.existsSync(path.join(helperAppPath(home), "Contents", "Info.plist"))).toBe(true);
    expect(fs.readFileSync(path.join(helperAppPath(home), "Contents", "Info.plist"), "utf8")).toContain(
      "<string>unvibe</string>",
    );
    expect(fs.existsSync(launchdPlistPath(home))).toBe(true);
    expect(lines).toEqual([]);
  });

  it("a setup failure prints the hint and still resolves (never fails the install)", async () => {
    const home = fakeHome();
    const failing: SetupRunner = { run: async () => ({ code: 1, stdout: "", stderr: "boom" }) };
    const { dep, lines } = deps(home, "darwin", { runner: failing });
    await expect(runPostinstall(dep)).resolves.toMatchObject({ action: "run" });
    expect(lines).toEqual([POSTINSTALL_HINT]);
  });

  it("a token failure also degrades to the hint", async () => {
    const home = fakeHome();
    const { dep, lines } = deps(home, "linux", {
      ensureToken: () => {
        throw new Error("read-only data dir");
      },
    });
    await expect(runPostinstall(dep)).resolves.toMatchObject({ action: "run" });
    expect(lines).toEqual([POSTINSTALL_HINT]);
  });

  it("hinted skips print exactly one line; silent skips print nothing", async () => {
    const home = fakeHome();
    const root = deps(home, "linux", { uid: 0 });
    await runPostinstall(root.dep);
    expect(root.lines).toEqual([POSTINSTALL_HINT]);

    const running = deps(home, "linux", { serviceRunning: true });
    await runPostinstall(running.dep);
    expect(running.lines).toEqual([]);
    expect(fs.existsSync(desktopFilePath(home))).toBe(false);
  });
});
