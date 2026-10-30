/**
 * Real-home guard (#313): a drill pointed at the real HOME is refused
 * before any write, so nothing real is touched.
 *
 * The "real" home here is captured the same way the guard captures it
 * (`os.userInfo().homedir`, via `UNVIBE_REAL_HOME` set by the vitest
 * harness). Tests only stat it (exists/mtime/size, never contents) and
 * assert it is unchanged after each refused call.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { installSetup, type SetupRunner } from "../src/cli/setup/index.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { runSwitchCore } from "../src/update/switch.js";
import {
  assertNotRealHomeForWrite,
  isTestRun,
  loginUnitPath,
  realDataDir,
  realHomeDir,
  refreshLoginUnitIfManaged,
  systemdUnitContent,
} from "../src/update/service-manager.js";

const TEST_ENV: NodeJS.ProcessEnv = { UNVIBE_TEST: "1", UNVIBE_REAL_HOME: realHomeDir() };

function meta(p: string): { exists: boolean; mtimeMs: number | null; size: number | null } {
  try {
    const st = fs.statSync(p);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false, mtimeMs: null, size: null };
  }
}

function scratchHome(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-home-")));
}

describe("real-home guard (#313)", () => {
  it("detects test markers", () => {
    expect(isTestRun({ UNVIBE_TEST: "1" })).toBe(true);
    expect(isTestRun({ VITEST: "true" })).toBe(true);
    expect(isTestRun({ UNVIBE_UPDATER_BACKEND: "fake" })).toBe(true);
    expect(isTestRun({})).toBe(false);
  });

  it("refuses a login-unit refresh pointed at the real HOME before any write", () => {
    const realHome = realHomeDir();
    const unit = loginUnitPath(realHome, process.platform);
    const before = meta(unit);
    expect(() =>
      refreshLoginUnitIfManaged(
        realHome,
        process.platform,
        { nodePath: "/n", cliPath: "/c", port: 1, dataDir: scratchHome() },
        () => {
          throw new Error("write must never be called for the real home");
        },
        TEST_ENV,
      ),
    ).toThrow(/real-home guard \(#313\)/);
    expect(meta(unit)).toEqual(before);
  });

  it("refuses a refresh whose data dir is the real data dir", () => {
    const home = scratchHome();
    expect(() =>
      refreshLoginUnitIfManaged(
        home,
        "linux",
        { nodePath: "/n", cliPath: "/c", port: 1, dataDir: realDataDir(TEST_ENV) },
        () => {},
        TEST_ENV,
      ),
    ).toThrow(/real-home guard \(#313\)/);
  });

  it("still refreshes a managed scratch home under a test marker", () => {
    const home = scratchHome();
    const unit = loginUnitPath(home, "linux");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, systemdUnitContent({ nodePath: "/old/node", cliPath: "/old/cli.js", port: 4517, dataDir: home }));
    const ok = refreshLoginUnitIfManaged(
      home,
      "linux",
      { nodePath: "/new/node", cliPath: "/new/cli.js", port: 4599, dataDir: home },
      undefined,
      TEST_ENV,
    );
    expect(ok).toBe(true);
    expect(fs.readFileSync(unit, "utf8")).toContain("/new/node");
  });

  it("refuses setup pointed at the real HOME before any write", async () => {
    const realHome = realHomeDir();
    const unit = loginUnitPath(realHome, process.platform);
    const before = meta(unit);
    const runner: SetupRunner = {
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
    };
    await expect(
      installSetup({ homeDir: realHome, nodePath: "/n", cliPath: "/x/cli.js" }, runner, process.platform, {
        dataDir: scratchHome(),
      }),
    ).rejects.toThrow(/real-home guard \(#313\)/);
    expect(meta(unit)).toEqual(before);
  });

  it("refuses a data-dir resolution pointing at the real data dir under a test marker", () => {
    const real = realDataDir(TEST_ENV);
    const before = meta(real);
    expect(() => loadConfig({ UNVIBE_TEST: "1", UNVIBE_REAL_HOME: realHomeDir(), UNVIBE_DATA_DIR: real })).toThrow(
      /real-home guard \(#313\)/,
    );
    expect(() => assertNotRealHomeForWrite({ dataDir: real }, TEST_ENV)).toThrow(/real-home guard \(#313\)/);
    expect(meta(real)).toEqual(before);
    // A scratch data dir under the same marker is fine.
    expect(loadConfig({ UNVIBE_TEST: "1", UNVIBE_DATA_DIR: scratchHome() }).dataDir).not.toBe(real);
  });

  it("refuses a switch drill whose data dir is the real data dir, before backup/install", async () => {
    const real = realDataDir(TEST_ENV);
    const before = meta(real);
    const runner = new FakeCommandRunner();
    const result = await runSwitchCore({
      runner,
      dataDir: real,
      serviceScriptPath: undefined,
      serviceVersion: "0",
      channel: "release",
      log: () => {},
    });
    // Under vitest the marker is present (VITEST), so the core refuses.
    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("real-home guard (#313)");
    expect(runner.calls).toEqual([]);
    expect(meta(real)).toEqual(before);
  });
});
