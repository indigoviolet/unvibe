/**
 * `unvibe setup` orchestration (PRD §14): per-install token, start-at-login
 * service (issue #108), platform URL handler (`unvibe://start` → start the
 * service), and `--uninstall`.
 *
 * Idempotent: re-running rewrites the same files and re-registers.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAUNCHD_LABEL,
  launchdPlistContent,
  launchdPlistPath,
  SYSTEMD_UNIT_NAME,
  systemdUnitContent,
  systemdUnitPath,
} from "./login.js";
import {
  appleScriptSource,
  helperAppPath,
  LSREGISTER,
  patchInfoPlist,
} from "./macos.js";
import { desktopFileContent, desktopFilePath, DESKTOP_FILENAME, URL_MIME } from "./linux.js";
import { assertNotRealHomeForWrite, isLoginManaged } from "../../update/service-manager.js";
import { isNpxCachePath, SETUP_NPX_MESSAGE } from "../npx.js";

/**
 * Whether `unvibe setup` has placed the link handler and the
 * start-at-login unit under this home. Pure file checks — no side
 * effects — so `unvibe start` can print the one-line setup hint
 * without ever running setup itself (issue #220).
 */
export function isSetupInstalled(homeDir: string, platform: SetupPlatform = process.platform): boolean {
  const handler = platform === "darwin" ? helperAppPath(homeDir) : desktopFilePath(homeDir);
  try {
    return fs.existsSync(handler) && isLoginManaged(homeDir, platform);
  } catch {
    return false;
  }
}

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
  // Invoked through the global bin, argv[1] is the bin symlink
  // (<prefix>/bin/unvibe); resolve it so the handler and login unit
  // always bake the real bundle path, however the CLI was invoked.
  let cliPath = process.argv[1] ?? fallbackCli;
  try {
    cliPath = fs.realpathSync(cliPath);
  } catch {
    // Keep the unresolved path; setup writes it as-is.
  }
  return {
    homeDir,
    nodePath: process.execPath,
    cliPath,
  };
}

export type SetupPlatform = "darwin" | "linux" | string;

function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export interface InstallSetupOpts {
  /** Service port baked into the login unit (defaults to 4517). */
  port?: number;
  /** Data dir baked into the login unit (defaults to the real one). */
  dataDir?: string;
  /** Skip the start-at-login unit (handler only). */
  noLogin?: boolean;
}

/** Install the `unvibe://` handler for this platform. Returns log lines. */
export async function installSetup(
  paths: SetupPaths,
  runner: SetupRunner = realSetupRunner(),
  platform: SetupPlatform = process.platform,
  opts: InstallSetupOpts = {},
): Promise<string[]> {
  // Real-home guard (#313): refuse before writing anything under a test
  // marker when the target home/data dir resolves to the real user's.
  assertNotRealHomeForWrite({ homeDir: paths.homeDir, dataDir: opts.dataDir });
  // Issue #277: refuse before writing anything — the npx cache path baked
  // into the handler and login unit would rot when npm prunes its cache.
  if (isNpxCachePath(paths.cliPath)) {
    throw new Error(SETUP_NPX_MESSAGE);
  }
  const steps: string[] = [];
  if (platform === "darwin") {
    const appPath = helperAppPath(paths.homeDir);
    rmrf(appPath);
    fs.mkdirSync(path.join(paths.homeDir, "Applications"), { recursive: true });
    const src = appleScriptSource(paths.nodePath, paths.cliPath);
    // Owned temp dir (issue #24): the running service leaked one
    // `unvibe-setup-*` dir per macOS setup. Remove it once osacompile
    // has read the source, even on failure.
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-setup-"));
    const srcFile = path.join(tmpBase, "UnvibeHelper.applescript");
    fs.writeFileSync(srcFile, src);
    try {
      const compiled = await runner.run("osacompile", ["-o", appPath, srcFile]);
      if (compiled.code !== 0) {
        throw new Error(`osacompile failed: ${compiled.stderr.trim() || compiled.stdout.trim()}`);
      }
    } finally {
      rmrf(tmpBase);
    }
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    const patched = patchInfoPlist(fs.readFileSync(plistPath, "utf8"));
    fs.writeFileSync(plistPath, patched);
    steps.push(`installed the link handler at ${appPath} (it opens unvibe://start links)`);
    const registered = await runner.run(LSREGISTER, ["-f", appPath]);
    steps.push(
      registered.code === 0
        ? "registered unvibe:// links with macOS"
        : `warning: couldn't register unvibe:// links (lsregister: ${registered.stderr.trim()}). Open ${appPath} once in Finder to register it.`,
    );
  } else if (platform === "linux") {
    const file = desktopFilePath(paths.homeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, desktopFileContent(paths.nodePath, paths.cliPath));
    steps.push(`installed the link handler at ${file} (it opens unvibe://start links)`);
    const mime = await runner.run("xdg-mime", ["default", DESKTOP_FILENAME, URL_MIME]);
    steps.push(
      mime.code === 0
        ? "registered unvibe:// links with your desktop"
        : `warning: couldn't register unvibe:// links (xdg-mime: ${mime.stderr.trim() || "no desktop session?"}). \`unvibe start\` still starts the service.`,
    );
    await runner.run("update-desktop-database", [path.dirname(file)]);
  } else {
    throw new Error(`unvibe setup works on macOS and Linux only (this is ${platform})`);
  }
  if (opts.noLogin) {
    steps.push("login start skipped (--no-login)");
    return steps;
  }
  steps.push(...(await installLoginUnit(paths, runner, platform, opts)));
  return steps;
}

/**
 * Write the start-at-login unit and enable it (issue #108). The file
 * write always happens; enabling is best-effort (headless sessions have
 * no login manager to talk to) and degrades to a warning naming the
 * manual command. Returns log lines.
 */
async function installLoginUnit(
  paths: SetupPaths,
  runner: SetupRunner,
  platform: SetupPlatform,
  opts: InstallSetupOpts,
): Promise<string[]> {
  assertNotRealHomeForWrite({ homeDir: paths.homeDir, dataDir: opts.dataDir });
  const unit = {
    nodePath: paths.nodePath,
    cliPath: paths.cliPath,
    port: opts.port ?? 4517,
    dataDir: opts.dataDir ?? "",
  };
  if (platform === "darwin") {
    const plist = launchdPlistPath(paths.homeDir);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, launchdPlistContent(unit));
    // Idempotent refresh of the login instance: unload whatever is there
    // (ignored when absent), then load. Never touches a manually started
    // service, which lives outside the login domain.
    const uid = os.userInfo().uid;
    await runner.run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`]);
    const loaded = await runner.run("launchctl", ["bootstrap", `gui/${uid}`, plist]);
    return [
      loaded.code === 0
        ? `service starts at login (launchd agent at ${plist}; never idle-exits there)`
        : `warning: login start not enabled (launchctl: ${loaded.stderr.trim() || loaded.stdout.trim() || "unknown error"}). Run: launchctl bootstrap gui/${uid} ${plist}`,
    ];
  }
  // Linux.
  const unitFile = systemdUnitPath(paths.homeDir);
  fs.mkdirSync(path.dirname(unitFile), { recursive: true });
  fs.writeFileSync(unitFile, systemdUnitContent(unit));
  await runner.run("systemctl", ["--user", "daemon-reload"]);
  const enabled = await runner.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
  return [
    enabled.code === 0
      ? `service starts at login (systemd user unit at ${unitFile}; never idle-exits there)`
      : `warning: login start not enabled (systemctl: ${enabled.stderr.trim() || enabled.stdout.trim() || "no user session?"}). Run: systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`,
  ];
}

/** Remove what `installSetup` created. Idempotent. Returns log lines. */
export async function uninstallSetup(
  paths: SetupPaths,
  runner: SetupRunner = realSetupRunner(),
  platform: SetupPlatform = process.platform,
): Promise<string[]> {
  assertNotRealHomeForWrite({ homeDir: paths.homeDir });
  const steps: string[] = [];
  if (platform === "darwin") {
    const appPath = helperAppPath(paths.homeDir);
    if (fs.existsSync(appPath)) {
      await runner.run(LSREGISTER, ["-u", appPath]);
      rmrf(appPath);
      steps.push(`removed ${appPath}`);
    } else {
      steps.push("no link handler installed; nothing to remove");
    }
    steps.push(...(await uninstallLoginUnit(paths, runner, platform)));
  } else if (platform === "linux") {
    const file = desktopFilePath(paths.homeDir);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      steps.push(`removed ${file}`);
    } else {
      steps.push("no link handler installed; nothing to remove");
    }
    await runner.run("update-desktop-database", [path.dirname(file)]);
    steps.push(...(await uninstallLoginUnit(paths, runner, platform)));
  } else {
    throw new Error(`unvibe setup works on macOS and Linux only (this is ${platform})`);
  }
  return steps;
}

/** Remove the start-at-login unit (issue #108). Idempotent. */
async function uninstallLoginUnit(
  paths: SetupPaths,
  runner: SetupRunner,
  platform: SetupPlatform,
): Promise<string[]> {
  if (platform === "darwin") {
    // Best-effort unload first: only our label, only the login domain.
    try {
      const uid = os.userInfo().uid;
      await runner.run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`]);
    } catch {
      // The runner never throws, but stay idempotent regardless.
    }
    const plist = launchdPlistPath(paths.homeDir);
    if (fs.existsSync(plist)) {
      fs.unlinkSync(plist);
      return [`removed ${plist} (service no longer starts at login)`];
    }
    return ["no login start installed; nothing to remove"];
  }
  // Best-effort disable first (ignored when absent or headless).
  await runner.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
  const unitFile = systemdUnitPath(paths.homeDir);
  if (fs.existsSync(unitFile)) {
    fs.unlinkSync(unitFile);
    return [`removed ${unitFile} (service no longer starts at login)`];
  }
  return ["no login start installed; nothing to remove"];
}

/**
 * What setup may create under a home dir (issue #108: the link handler
 * plus the start-at-login unit). Tests assert nothing else appears.
 */
export function setupAllowedRoots(homeDir: string, platform: SetupPlatform): string[] {
  if (platform === "darwin")
    return [path.join(homeDir, "Applications", "Unvibe.app"), launchdPlistPath(homeDir)];
  return [
    path.join(homeDir, ".local", "share", "applications", DESKTOP_FILENAME),
    systemdUnitPath(homeDir),
  ];
}
