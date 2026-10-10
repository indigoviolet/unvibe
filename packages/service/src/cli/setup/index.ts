/**
 * `unvibe setup` orchestration (PRD §14): per-install token, platform URL
 * handler (`unvibe://start` → start the service), and `--uninstall`.
 *
 * Idempotent: re-running rewrites the same files and re-registers.
 * Nothing starts at login: no LaunchAgents, no systemd units, no autostart
 * entries are written anywhere (asserted by test).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appleScriptSource,
  helperAppPath,
  LSREGISTER,
  patchInfoPlist,
} from "./macos.js";
import { desktopFileContent, desktopFilePath, DESKTOP_FILENAME, URL_MIME } from "./linux.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SetupRunner {
  run(cmd: string, args: string[]): Promise<RunResult>;
}

export function realSetupRunner(timeoutMs = 60_000): SetupRunner {
  return {
    run: (cmd, args) =>
      new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            resolve({ code: 127, stdout: "", stderr: `${cmd}: not found` });
            return;
          }
          resolve({
            code: typeof (err as { code?: unknown } | null)?.code === "number"
              ? ((err as { code: number }).code ?? 1)
              : err
                ? 1
                : 0,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? "") + (err && !(err as Error).message.includes("Command failed") ? (err as Error).message : ""),
          });
        });
      }),
  };
}

export interface SetupPaths {
  homeDir: string;
  nodePath: string;
  cliPath: string;
}

/** Real launcher paths. `homeDir` is injectable for tests (fake HOME). */
export function resolveSetupPaths(homeDir: string = os.homedir()): SetupPaths {
  // Bundled CLI (dist/index.js): the module itself is the entry point.
  // Under vitest/ts-src the module is src/cli/setup/index.ts, so the
  // entry is two levels up instead.
  const here = fileURLToPath(import.meta.url);
  const fallbackCli = here.includes(`${path.sep}src${path.sep}`)
    ? fileURLToPath(new URL("../../index.js", import.meta.url))
    : here;
  return {
    homeDir,
    nodePath: process.execPath,
    cliPath: process.argv[1] ?? fallbackCli,
  };
}

export type SetupPlatform = "darwin" | "linux" | string;

function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

/** Install the `unvibe://` handler for this platform. Returns log lines. */
export async function installSetup(
  paths: SetupPaths,
  runner: SetupRunner = realSetupRunner(),
  platform: SetupPlatform = process.platform,
): Promise<string[]> {
  const steps: string[] = [];
  if (platform === "darwin") {
    const appPath = helperAppPath(paths.homeDir);
    rmrf(appPath);
    fs.mkdirSync(path.join(paths.homeDir, "Applications"), { recursive: true });
    const src = appleScriptSource(paths.nodePath, paths.cliPath);
    const srcFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-setup-")),
      "UnvibeHelper.applescript",
    );
    fs.writeFileSync(srcFile, src);
    const compiled = await runner.run("osacompile", ["-o", appPath, srcFile]);
    if (compiled.code !== 0) {
      throw new Error(`osacompile failed: ${compiled.stderr.trim() || compiled.stdout.trim()}`);
    }
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    const patched = patchInfoPlist(fs.readFileSync(plistPath, "utf8"));
    fs.writeFileSync(plistPath, patched);
    steps.push(`helper app written to ${appPath} (handles unvibe://start)`);
    const registered = await runner.run(LSREGISTER, ["-f", appPath]);
    steps.push(
      registered.code === 0
        ? "registered unvibe:// with LaunchServices"
        : `warning: lsregister failed (${registered.stderr.trim()}), opening the app once registers it instead`,
    );
  } else if (platform === "linux") {
    const file = desktopFilePath(paths.homeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, desktopFileContent(paths.nodePath, paths.cliPath));
    steps.push(`desktop handler written to ${file} (handles unvibe://start)`);
    const mime = await runner.run("xdg-mime", ["default", DESKTOP_FILENAME, URL_MIME]);
    steps.push(
      mime.code === 0
        ? "registered unvibe:// with xdg-mime"
        : `warning: xdg-mime failed (${mime.stderr.trim() || "no desktop session?"}), invoking the Exec line directly still starts the service`,
    );
    await runner.run("update-desktop-database", [path.dirname(file)]);
  } else {
    throw new Error(`unsupported platform for setup: ${platform}`);
  }
  return steps;
}

/** Remove what `installSetup` created. Idempotent. Returns log lines. */
export async function uninstallSetup(
  paths: SetupPaths,
  runner: SetupRunner = realSetupRunner(),
  platform: SetupPlatform = process.platform,
): Promise<string[]> {
  const steps: string[] = [];
  if (platform === "darwin") {
    const appPath = helperAppPath(paths.homeDir);
    if (fs.existsSync(appPath)) {
      await runner.run(LSREGISTER, ["-u", appPath]);
      rmrf(appPath);
      steps.push(`removed ${appPath}`);
    } else {
      steps.push("helper app not present; nothing to remove");
    }
  } else if (platform === "linux") {
    const file = desktopFilePath(paths.homeDir);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      steps.push(`removed ${file}`);
    } else {
      steps.push("desktop handler not present; nothing to remove");
    }
    await runner.run("update-desktop-database", [path.dirname(file)]);
  } else {
    throw new Error(`unsupported platform for setup: ${platform}`);
  }
  return steps;
}

/**
 * Fail closed when setup would write login items: the allow-list of roots
 * setup may create under a home dir. Tests assert nothing else appears.
 */
export function setupAllowedRoots(homeDir: string, platform: SetupPlatform): string[] {
  if (platform === "darwin") return [path.join(homeDir, "Applications", "Unvibe.app")];
  return [path.join(homeDir, ".local", "share", "applications", DESKTOP_FILENAME)];
}
