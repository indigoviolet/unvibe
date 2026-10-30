/**
 * npx guards (issue #277): `setup` and `update` (CLI + in-app switcher)
 * refuse when running from an npx cache. No real npx run, no network:
 * scratch HOME and fake package paths containing `/_npx/<hash>/`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isNpxCachePath, SETUP_NPX_MESSAGE, UPDATE_NPX_MESSAGE } from "../src/cli/npx.js";
import { installSetup } from "../src/cli/setup/index.js";
import { runUpdateChannelFlow } from "../src/cli/update-flows.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { openDatabase } from "../src/store/db.js";
import { migrate } from "../src/store/migrate.js";
import { createApp } from "../src/server.js";
import { SettingsStore } from "../src/settings/index.js";
import { JobQueue } from "../src/jobs/queue.js";
import { FakeUpdater } from "../src/update/updater.js";

function tmpHome(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function npxCliPath(root: string): string {
  // `<npmcache>/_npx/<hash>/node_modules/unvibe/...` (evaluation write-up).
  return path.join(root, "cache", "_npx", "42d8905e797e0191", "node_modules", "unvibe", "packages", "service", "dist", "index.js");
}

function globalCliPath(root: string): string {
  return path.join(root, "prefix", "lib", "node_modules", "unvibe", "packages", "service", "dist", "index.js");
}

describe("isNpxCachePath", () => {
  it("detects the npx cache layout from the resolved script path", () => {
    expect(isNpxCachePath("/tmp/npm-cache/_npx/42d8905e797e0191/node_modules/unvibe/packages/service/dist/index.js")).toBe(true);
    expect(isNpxCachePath(npxCliPath(tmpHome("unvibe-npx-detect-")))).toBe(true);
  });

  it("leaves normal layouts alone", () => {
    expect(isNpxCachePath("/usr/local/lib/node_modules/unvibe/packages/service/dist/index.js")).toBe(false);
    expect(isNpxCachePath("/repo/packages/service/dist/index.js")).toBe(false);
    expect(isNpxCachePath(undefined)).toBe(false);
    expect(isNpxCachePath(null)).toBe(false);
    expect(isNpxCachePath("")).toBe(false);
  });
});

describe("setup under npx", () => {
  it("refuses before writing anything", async () => {
    const home = tmpHome("unvibe-npx-setup-");
    const cliPath = npxCliPath(tmpHome("unvibe-npx-cache-"));
    let calls = 0;
    await expect(
      installSetup(
        { homeDir: home, nodePath: process.execPath, cliPath },
        { run: async () => { calls += 1; return { code: 0, stdout: "", stderr: "" }; } },
        "linux",
      ),
    ).rejects.toThrow(SETUP_NPX_MESSAGE);
    expect(calls).toBe(0);
    // Nothing placed under the scratch HOME.
    expect(fs.existsSync(path.join(home, ".local", "share", "applications"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".config", "systemd"))).toBe(false);
  });

  it("still installs for a normal global layout", async () => {
    const home = tmpHome("unvibe-npx-setup-ok-");
    const cliPath = globalCliPath(tmpHome("unvibe-npx-global-"));
    const steps = await installSetup(
      { homeDir: home, nodePath: process.execPath, cliPath },
      { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      "linux",
    );
    expect(steps.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(home, ".local", "share", "applications", "unvibe-open.desktop"))).toBe(true);
  });
});

describe("update under npx", () => {
  it("refuses before touching npm or the database", async () => {
    const dataDir = tmpHome("unvibe-npx-update-data-");
    const runner = new FakeCommandRunner();
    const out = await runUpdateChannelFlow(
      {
        runner,
        dataDir,
        cliScriptPath: npxCliPath(tmpHome("unvibe-npx-update-cache-")),
        serviceVersion: "0.0.1",
        homeDir: tmpHome("unvibe-npx-update-home-"),
        platform: process.platform,
      },
      "preview/feat-x",
    );
    expect(out.code).toBe(1);
    expect(out.lines).toEqual([UPDATE_NPX_MESSAGE]);
    expect(runner.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(dataDir, "channel-backups"))).toBe(false);
  });

  it("still works for a normal global layout (same commit is a no-op)", async () => {
    const dataDir = tmpHome("unvibe-npx-update-ok-");
    const runner = new FakeCommandRunner();
    const root = tmpHome("unvibe-npx-update-ok-installed-");
    const packagePath = path.join(root, "package.json");
    fs.mkdirSync(path.join(root, "packages", "service", "dist"), { recursive: true });
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ name: "unvibe", version: "0.0.1", unvibe: { channel: "release", commit: "abc1234full" } }),
    );
    const scriptPath = path.join(root, "packages", "service", "dist", "index.js");
    fs.writeFileSync(scriptPath, "");
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=release"],
      stdout: JSON.stringify({
        content: Buffer.from(
          JSON.stringify({ name: "unvibe", version: "0.0.1", unvibe: { channel: "release", commit: "abc1234full" } }),
        ).toString("base64"),
        encoding: "base64",
      }),
      stderr: "",
      code: 0,
    });
    const out = await runUpdateChannelFlow(
      { runner, dataDir, cliScriptPath: scriptPath, serviceVersion: "0.0.1", homeDir: tmpHome("unvibe-npx-update-ok-home-"), platform: process.platform },
      "release",
    );
    expect(out.code).toBe(0);
    expect(out.lines.some((l) => l.includes("nothing to do"))).toBe(true);
    expect(runner.calls.filter((c) => c.cmd === "npm")).toHaveLength(0);
  });
});

describe("in-app switcher under npx", () => {
  it("reports switching as unavailable instead of running npm", async () => {
    const TOKEN = "npx-test-token";
    // Fake npx install tree: argv[1] inside `/_npx/<hash>/`, with a real
    // channel record so the refusal is the npx guard, not the
    // not-installed guard.
    const root = tmpHome("unvibe-npx-cache-");
    const cacheRoot = path.join(root, "cache", "_npx", "42d8905e797e0191", "node_modules", "unvibe");
    fs.mkdirSync(path.join(cacheRoot, "packages", "service", "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(cacheRoot, "package.json"),
      JSON.stringify({ name: "unvibe", version: "0.0.1", unvibe: { channel: "release" } }),
    );
    const scriptPath = path.join(cacheRoot, "packages", "service", "dist", "index.js");
    fs.writeFileSync(scriptPath, "");
    const savedArgv1 = process.argv[1];
    process.argv[1] = scriptPath;
    const db = openDatabase(":memory:");
    migrate(db);
    const dataDir = tmpHome("unvibe-npx-switch-data-");
    let spawned = 0;
    const created = await createApp(TOKEN, {
      db,
      dataDir,
      // Scratch HOME (#313): the switch route must not resolve the real home.
      loginHome: { homeDir: tmpHome("unvibe-npx-switch-home-"), platform: process.platform },
      settings: new SettingsStore(db),
      jobs: new JobQueue(),
      updater: new FakeUpdater(dataDir),
      updateHooks: {
        spawnHelper: async () => { spawned += 1; return 9999; },
        requestShutdown: () => {},
        shutdownDelayMs: 0,
      },
    });
    try {
      const res = await created.app.inject({
        method: "POST",
        url: "/api/update/switch",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        payload: JSON.stringify({ ref: "preview/feat-x" }),
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe(UPDATE_NPX_MESSAGE);
      expect(spawned).toBe(0);
    } finally {
      process.argv[1] = savedArgv1;
      await created.app.close();
    }
  });
});
