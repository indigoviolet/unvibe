/**
 * mise-managed Node update PATH (issue #170).
 *
 * The owner's in-app switch failed this way: the updater ran mise's wrapped
 * npm with a PATH holding the mise-managed node binaries but not `mise`
 * itself. npm finished ("changed 169 packages"), then the wrapper's
 * post-install reshim step died with "mise: command not found" (exit 127).
 * The updater counted that as a failed install and rolled back into the
 * same failure, leaving the app stopped.
 *
 * These tests use a fake `npm` shaped like mise's wrapper (a successful
 * fake install, then a bare `mise` call) through the real command runner
 * with a scrubbed PATH, plus the switch core over a stubbed runner. Fake
 * scripts live in temp dirs only; nothing touches real npm, mise or the
 * network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/runner.js";
import type { RunOptions, RunResult } from "../src/exec/runner.js";
import { installRef } from "../src/update/install.js";
import { runSwitchCore } from "../src/update/switch.js";
import { applyEffectivePath } from "../src/update/helper.js";
import { resolveUpdatePathEnv } from "../src/update/update-env.js";

function tmpDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeExecutable(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

/** Assert no `mise` is resolvable on these dirs, so the scrubbed PATH is hermetic. */
function expectNoMiseOnPath(dirs: string[]): void {
  for (const dir of dirs) {
    let executable = false;
    try {
      fs.accessSync(path.join(dir, "mise"), fs.constants.X_OK);
      executable = fs.statSync(path.join(dir, "mise")).isFile();
    } catch {
      executable = false;
    }
    expect(executable, `unexpected mise on test PATH in ${dir}`).toBe(false);
  }
}

/**
 * Fake npm shaped like mise's wrapper: report a finished install, then call
 * bare `mise` (the reshim step). Exit 127 with "mise ... not found" when
 * `mise` is missing from PATH, 0 when the (fake) mise answers.
 */
function makeWrapperNpm(dir: string): void {
  makeExecutable(dir, "npm", "#!/bin/sh\nset -eu\necho \"changed 169 packages in 2s\"\nmise reshim\n");
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

/** `gh api .../contents/package.json` response body for a package. */
function contentsStdout(pkg: unknown): string {
  return JSON.stringify({
    content: Buffer.from(JSON.stringify(pkg)).toString("base64"),
    encoding: "base64",
  });
}

const NEW_PKG = {
  name: "unvibe",
  version: "0.0.1-preview.feat-x.abc1234",
  unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
};

/**
 * Stub shaped like the old mise npm wrapper: the install renews the files,
 * then the post-install reshim step fails with 127 because `mise` is not
 * on PATH. Serves `gh` contents for canned ref packages like the existing
 * `SwitchRunner` in `update.test.ts`.
 */
class WrapperHookRunner {
  readonly calls: { cmd: string; opts: RunOptions }[] = [];
  constructor(
    private packagePath: string,
    private landedPkg: unknown,
    private refPkgs: Record<string, unknown> = {},
  ) {}
  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    this.calls.push({ cmd, opts });
    if (cmd === "gh") {
      const m = /contents\/package\.json\?ref=(.+)$/.exec(opts.args[1] ?? "");
      const pkg = m ? this.refPkgs[m[1]] : undefined;
      if (pkg === undefined) return { stdout: "", stderr: "not found", code: 1 };
      return { stdout: contentsStdout(pkg), stderr: "", code: 0 };
    }
    if (cmd === "npm" && opts.args[0] === "install") {
      fs.writeFileSync(this.packagePath, JSON.stringify(this.landedPkg));
      return {
        stdout: "changed 169 packages in 2s",
        stderr: "npm: line 76: mise: command not found",
        code: 127,
      };
    }
    if (cmd === "npm" && opts.args[0] === "prefix") {
      return { stdout: "/fake/prefix\n", stderr: "", code: 0 };
    }
    throw new Error(`unexpected command: ${cmd} ${opts.args.join(" ")}`);
  }
}

describe("mise-wrapper npm through the updater", () => {
  it("fails with 127 when mise is missing from PATH (the owner's failure)", async () => {
    const npmDir = tmpDir("unvibe-wrapper-npm-");
    makeWrapperNpm(npmDir);
    const scrubbed = [npmDir, "/usr/bin", "/bin"];
    expectNoMiseOnPath(scrubbed);
    const prevPath = process.env.PATH;
    process.env.PATH = scrubbed.join(":");
    try {
      const res = await installRef(new RealCommandRunner(), "preview/feat-x");
      expect(res.code).toBe(127);
      // npm finished, then the wrapper could not find mise.
      expect(res.stdout).toContain("changed 169 packages");
      expect(`${res.stdout}\n${res.stderr}`).toMatch(/mise.*not found/i);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("finds mise on the probed login-shell PATH", async () => {
    const npmDir = tmpDir("unvibe-probed-npm-");
    makeWrapperNpm(npmDir);
    const miseDir = tmpDir("unvibe-probed-mise-");
    makeExecutable(miseDir, "mise", "#!/bin/sh\nexit 0\n");
    // Fake login shell: the interactive PATH carries the mise dir, the
    // inherited PATH does not (mise activated in .zshrc, not inherited).
    const binDir = tmpDir("unvibe-probed-shell-");
    const fakeShell = makeExecutable(
      binDir,
      "probesh",
      "#!/bin/sh\nprintf \"__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n\" \"" +
        `${miseDir}:/usr/bin:/bin"\n`,
    );
    const inheritedPath = [npmDir, "/usr/bin", "/bin"].join(":");
    expectNoMiseOnPath([npmDir, "/usr/bin", "/bin"]);
    const updateEnv = await resolveUpdatePathEnv({
      candidates: [fakeShell],
      inheritedPath,
      timeoutMs: 3000,
    });
    expect(updateEnv.PATH.split(":")).toContain(miseDir);
    expect(updateEnv.PATH.split(":")).toContain(npmDir);
    const prevPath = process.env.PATH;
    process.env.PATH = inheritedPath;
    try {
      const res = await installRef(new RealCommandRunner(), "preview/feat-x", { env: updateEnv });
      expect(res.code).toBe(0);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("falls back to the inherited PATH when no shell answers", async () => {
    const binDir = tmpDir("unvibe-probed-silent-");
    const silent = makeExecutable(binDir, "silentsh", "#!/bin/sh\nexit 0\n");
    const env = await resolveUpdatePathEnv({
      candidates: [silent],
      inheritedPath: "/only/inherited",
      timeoutMs: 1000,
    });
    expect(env).toEqual({ PATH: "/only/inherited" });
  });
});

describe("switch core with a wrapper-hook failure", () => {
  function failedWrapperResult(): { stdout: string; stderr: string; code: number } {
    return {
      stdout: "changed 169 packages in 2s",
      stderr: "npm: line 76: mise: command not found",
      code: 127,
    };
  }

  it("runs npm with the repaired PATH", async () => {
    const dataDir = tmpDir("unvibe-core-path-");
    const { scriptPath } = makeInstall(tmpDir("unvibe-core-path-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: contentsStdout(NEW_PKG),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "npm", ...failedWrapperResult() });
    await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0.0.1",
      channel: "preview/feat-x",
      env: { PATH: "/fake/mise/bin:/usr/bin" },
      log: () => {},
    });
    const npmCall = runner.calls.find((c) => c.cmd === "npm");
    expect(npmCall?.opts.env?.["PATH"]).toBe("/fake/mise/bin:/usr/bin");
  });

  it("treats a failed wrapper hook as a verified install when the new build is in place", async () => {
    const dataDir = tmpDir("unvibe-core-landed-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath, packagePath } = makeInstall(tmpDir("unvibe-core-landed-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    // The old wrapper shape: npm renews the files, then its reshim step
    // fails with 127 after the install finished.
    const runner = new WrapperHookRunner(packagePath, NEW_PKG, { "preview/feat-x": NEW_PKG });
    const result = await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0.0.1",
      channel: "preview/feat-x",
      log: () => {},
    });
    // Verified in place: no rollback into the same failure.
    expect(result.code).toBe(0);
    expect(result.installed).toBe(true);
    const text = result.lines.join("\n");
    expect(text).toMatch(/mise/);
    expect(text).toMatch(/verified|continues/);
    expect(text).toContain("0.0.1-preview.feat-x.abc1234");
  });

  it("names the mise wrapper cause and the terminal recovery when the install did not land", async () => {
    const dataDir = tmpDir("unvibe-core-genuine-");
    fs.writeFileSync(path.join(dataDir, "unvibe.db"), "release-db");
    const { scriptPath } = makeInstall(tmpDir("unvibe-core-genuine-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: contentsStdout(NEW_PKG),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "npm", ...failedWrapperResult() });
    const result = await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0.0.1",
      channel: "preview/feat-x",
      log: () => {},
    });
    expect(result.code).toBe(1);
    const text = result.lines.join("\n");
    expect(text).toMatch(/mise wrapper could not find the mise command/);
    expect(text).toContain("unvibe update preview/feat-x");
    expect(text).toContain("unvibe start");
    // The live database is untouched and the backup survives.
    expect(fs.readFileSync(path.join(dataDir, "unvibe.db"), "utf8")).toBe("release-db");
  });

  it("keeps a non-mise failure generic", async () => {
    const dataDir = tmpDir("unvibe-core-plain-");
    const { scriptPath } = makeInstall(tmpDir("unvibe-core-plain-installed-"), {
      name: "unvibe",
      version: "0.0.1",
      unvibe: { channel: "release" },
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: contentsStdout(NEW_PKG),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "npm", stdout: "", stderr: "network down", code: 1 });
    const result = await runSwitchCore({
      runner,
      dataDir,
      serviceScriptPath: scriptPath,
      serviceVersion: "0.0.1",
      channel: "preview/feat-x",
      log: () => {},
    });
    expect(result.code).toBe(1);
    const text = result.lines.join("\n");
    expect(text).toContain("npm install failed");
    expect(text).not.toMatch(/mise wrapper/);
  });

  it("verifies a same-channel reinstall against the published commit", async () => {
    const installedPkg = {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.older",
      unvibe: { channel: "preview/feat-x", commit: "older1234full" },
    };
    const landedPkg = {
      name: "unvibe",
      version: "0.0.1-preview.feat-x.abc1234",
      unvibe: { channel: "preview/feat-x", commit: "abc1234full" },
    };
    // Landed despite the hook failure: success.
    const landedDir = tmpDir("unvibe-core-same-ok-");
    const landed = makeInstall(tmpDir("unvibe-core-same-ok-installed-"), installedPkg);
    const okRunner = new WrapperHookRunner(landed.packagePath, landedPkg, {
      "preview/feat-x": landedPkg,
    });
    const ok = await runSwitchCore({
      runner: okRunner,
      dataDir: landedDir,
      serviceScriptPath: landed.scriptPath,
      serviceVersion: "0",
      channel: "preview/feat-x",
      log: () => {},
    });
    expect(ok.code).toBe(0);

    // Published commit unreadable: the hook failure cannot be verified, so it fails.
    const blindDir = tmpDir("unvibe-core-same-blind-");
    const blind = makeInstall(tmpDir("unvibe-core-same-blind-installed-"), installedPkg);
    const blindRunner = new FakeCommandRunner();
    blindRunner.enqueue({
      cmd: "gh",
      args: ["api", "repos/indigoviolet/unvibe/contents/package.json?ref=preview/feat-x"],
      stdout: "",
      stderr: "not found",
      code: 1,
    });
    blindRunner.enqueue({ cmd: "npm", ...failedWrapperResult() });
    const blindResult = await runSwitchCore({
      runner: blindRunner,
      dataDir: blindDir,
      serviceScriptPath: blind.scriptPath,
      serviceVersion: "0",
      channel: "preview/feat-x",
      log: () => {},
    });
    expect(blindResult.code).toBe(1);
  });
});

describe("applyEffectivePath", () => {
  it("restores the service's repaired PATH and ignores empty values", () => {
    const prev = process.env.PATH;
    try {
      process.env.PATH = "/minimal";
      applyEffectivePath("/repaired:/minimal");
      expect(process.env.PATH).toBe("/repaired:/minimal");
      applyEffectivePath("");
      expect(process.env.PATH).toBe("/repaired:/minimal");
      applyEffectivePath(undefined);
      expect(process.env.PATH).toBe("/repaired:/minimal");
    } finally {
      process.env.PATH = prev;
    }
  });
});
