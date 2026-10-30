/**
 * Start-at-login service management (issue #108).
 *
 * Rule: when the login unit is installed ("managed"), all process control
 * goes through the service manager — `launchctl` on macOS, `systemctl
 * --user` on Linux. When it is not installed, the CLI owns the process
 * directly, exactly as before. "Managed" is detected from the unit file's
 * presence under a home dir (the real `os.homedir()` at runtime; tests
 * pass a fake HOME).
 *
 * Why: the units restart the service on crash (macOS `KeepAlive` with
 * `SuccessfulExit: false`, Linux `Restart=on-failure`), so a deliberate
 * stop must go through the manager — SIGTERMing the pid directly would be
 * undone on macOS, and a directly-spawned replacement on Linux would run
 * unmanaged (with idle exit) beside the still-enabled unit. The update
 * helper restarts through the manager for the same reason: a direct spawn
 * would leave an unmanaged generation holding the port while launchd's
 * next login start crashes on EADDRINUSE.
 *
 * Bundle note: this module is imported by the self-contained
 * `dist/update-helper.js` bundle (issue #36), so it may use node builtins
 * only (`fs`/`os`/`path`) and must not import sibling `src/` modules. The
 * content builders (`launchdPlistContent`, `systemdUnitContent`) stay in
 * `cli/setup/login.ts`, which imports the constants and paths from here.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LAUNCHD_LABEL = "com.unvibe.service";
export const LAUNCHD_PLIST_FILENAME = `${LAUNCHD_LABEL}.plist`;
export const SYSTEMD_UNIT_NAME = "unvibe.service";

export type ManagerPlatform = "darwin" | "linux";

/** `~/Library/LaunchAgents/com.unvibe.service.plist` (macOS). */
export function launchdPlistPath(homeDir: string): string {
  return path.join(homeDir, "Library", "LaunchAgents", LAUNCHD_PLIST_FILENAME);
}

/** `~/.config/systemd/user/unvibe.service` (Linux). */
export function systemdUnitPath(homeDir: string): string {
  return path.join(homeDir, ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
}

/** Unit file for this platform under a home dir. */
export function loginUnitPath(homeDir: string, platform: string): string {
  return platform === "darwin" ? launchdPlistPath(homeDir) : systemdUnitPath(homeDir);
}

// --- Real-home guard (#313) -------------------------------------------------
// Fail fast at the source: under a test marker, never write a login unit
// or use a data dir that resolves to the real user's. Harnesses set
// `UNVIBE_TEST=1` (plus `UNVIBE_REAL_HOME` captured at harness start);
// vitest sets `VITEST`; fake-updater drills set
// `UNVIBE_UPDATER_BACKEND=fake`. Metadata/path comparison only.

/** True when this process is running under a test/drill harness. */
export function isTestRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNVIBE_TEST === "1" || env.VITEST === "true" || env.VITEST === "1" || env.UNVIBE_UPDATER_BACKEND === "fake";
}

/** The real user's home (never a harness-scratch HOME). */
export function realHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const captured = env.UNVIBE_REAL_HOME;
  if (captured) return path.resolve(captured);
  try {
    const info = os.userInfo();
    if (info && typeof info.homedir === "string" && info.homedir) return path.resolve(info.homedir);
  } catch {
    // fall through to os.homedir()
  }
  return path.resolve(os.homedir());
}

/** The real data dir (`~/.local/share/unvibe`). */
export function realDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(realHomeDir(env), ".local", "share", "unvibe");
}

function resolved(p: string): string {
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

function isSameOrUnder(candidate: string, base: string): boolean {
  const c = resolved(candidate);
  const b = resolved(base);
  return c === b || c.startsWith(b + path.sep);
}

/**
 * Throw when, under a test marker, a write would touch the real home:
 * the home dir itself, a login-unit path under the real home, or the
 * real data dir. Called before any write, so nothing real is touched.
 */
export function assertNotRealHomeForWrite(
  target: { homeDir?: string; unitPath?: string; dataDir?: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isTestRun(env)) return;
  const realHome = realHomeDir(env);
  const realUnitLinux = systemdUnitPath(realHome);
  const realUnitDarwin = launchdPlistPath(realHome);
  const realData = realDataDir(env);
  const problems: string[] = [];
  if (target.homeDir && resolved(target.homeDir) === realHome) {
    problems.push(`home dir resolves to the real home (${realHome})`);
  }
  if (target.unitPath) {
    const u = resolved(target.unitPath);
    if (u === realUnitLinux || u === realUnitDarwin) {
      problems.push(`login unit path resolves to the real unit (${u})`);
    }
  }
  if (target.dataDir && isSameOrUnder(target.dataDir, realData)) {
    problems.push(`data dir resolves to the real data dir (${realData})`);
  }
  if (problems.length > 0) {
    throw new Error(
      `real-home guard (#313): refusing to touch the real home under a test marker (${problems.join("; ")}). ` +
        `Point HOME, the login-unit path and UNVIBE_DATA_DIR at a scratch directory instead.`,
    );
  }
}

/** True when `unvibe setup` installed the start-at-login unit. */
export function isLoginManaged(homeDir: string, platform: string): boolean {
  try {
    return fs.existsSync(loginUnitPath(homeDir, platform));
  } catch {
    return false;
  }
}

/** Current uid for `launchctl ... gui/<uid>/...`, or null when unknown. */
export function currentUid(): number | null {
  try {
    const uid = os.userInfo().uid;
    return typeof uid === "number" && Number.isSafeInteger(uid) ? uid : null;
  } catch {
    return null;
  }
}

export interface ManagerCmd {
  cmd: string;
  args: string[];
}

/** Stop the managed service (deliberate stop; crash-only restart leaves it down). */
export function stopServiceCommands(platform: string, uid: number | null): ManagerCmd[] {
  if (platform === "darwin" && uid !== null) {
    return [{ cmd: "launchctl", args: ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`] }];
  }
  if (platform === "darwin") return [];
  return [{ cmd: "systemctl", args: ["--user", "stop", SYSTEMD_UNIT_NAME] }];
}

/**
 * Start (or reload) the managed service. macOS `bootstrap` loads the job
 * (and starts it via RunAtLoad); when it is already loaded but down,
 * callers fall back to `kickstartServiceCommands`.
 */
export function startServiceCommands(platform: string, uid: number | null, unitPath: string): ManagerCmd[] {
  if (platform === "darwin") {
    if (uid === null) return [];
    return [{ cmd: "launchctl", args: ["bootstrap", `gui/${uid}`, unitPath] }];
  }
  return [{ cmd: "systemctl", args: ["--user", "start", SYSTEMD_UNIT_NAME] }];
}

/** Start an already-loaded but stopped launchd job. */
export function kickstartServiceCommands(uid: number | null): ManagerCmd[] {
  if (uid === null) return [];
  return [{ cmd: "launchctl", args: ["kickstart", `gui/${uid}/${LAUNCHD_LABEL}`] }];
}

/** After a failed manager start, unload again so a broken job cannot crash-loop on the port. */
export function unloadServiceCommands(platform: string, uid: number | null): ManagerCmd[] {
  return stopServiceCommands(platform, uid);
}

export interface ManagerRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ManagerRunner {
  run(cmd: string, args: string[]): Promise<ManagerRunResult>;
}

export interface ManagerOp {
  runner: ManagerRunner;
  log(message: string): void;
  platform: string;
  uid: number | null;
  unitPath: string;
}

async function runManagerCmd(op: ManagerOp, c: ManagerCmd): Promise<ManagerRunResult> {
  try {
    return await op.runner.run(c.cmd, c.args);
  } catch (err) {
    // The stub runner never throws, but stay best-effort regardless.
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stop the managed service. Best-effort, never throws: a failing manager
 * (headless session, job not loaded) just means the caller falls back to
 * the pid-based stop. Returns whether the manager reported success.
 */
export async function stopManagedService(op: ManagerOp): Promise<boolean> {
  const cmds = stopServiceCommands(op.platform, op.uid);
  if (cmds.length === 0) return false;
  let ok = true;
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code !== 0) {
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
      ok = false;
    }
  }
  return ok;
}

/**
 * Start the managed service. Never throws; returns true when a manager
 * command reported success (the caller still verifies health). macOS
 * falls back to `kickstart` when `bootstrap` fails (already loaded).
 */
export async function startManagedService(op: ManagerOp): Promise<boolean> {
  const cmds = startServiceCommands(op.platform, op.uid, op.unitPath);
  if (cmds.length === 0) {
    op.log("warning: cannot drive the service manager here (no login uid); falling back");
    return false;
  }
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code === 0) return true;
    op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
  }
  if (op.platform === "darwin") {
    for (const c of kickstartServiceCommands(op.uid)) {
      const r = await runManagerCmd(op, c);
      if (r.code === 0) return true;
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
    }
  }
  return false;
}

/** Best-effort unload after a failed start, so a broken job cannot crash-loop on the port. */
export async function unloadManagedService(op: ManagerOp): Promise<void> {
  for (const c of unloadServiceCommands(op.platform, op.uid)) {
    await runManagerCmd(op, c);
  }
}

/** `status` suffix naming login management. */
export function managedStatusText(homeDir: string, platform: string): string | null {
  if (!isLoginManaged(homeDir, platform)) return null;
  return "starts at login";
}

export interface LoginUnitOpts {
  nodePath: string;
  cliPath: string;
  port: number;
  dataDir: string;
}

/** XML-escape for plist string values. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * launchd agent plist: run at load, restart on crash only, never
 * idle-exit. A deliberate stop exits 0 and is respected (with plain
 * `KeepAlive true` launchd would undo the stop at once); mirrors systemd
 * `Restart=on-failure`.
 */
export function launchdPlistContent(opts: LoginUnitOpts): string {
  const { nodePath, cliPath, port, dataDir } = opts;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${xmlEscape(nodePath)}</string>`,
    `    <string>${xmlEscape(cliPath)}</string>`,
    "    <string>start</string>",
    "    <string>--foreground</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>UNVIBE_PORT</key>",
    `    <string>${port}</string>`,
    "    <key>UNVIBE_DATA_DIR</key>",
    `    <string>${xmlEscape(dataDir)}</string>`,
    "    <key>UNVIBE_IDLE_MS</key>",
    "    <string>0</string>",
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(dataDir)}/unvibe-login.log</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(dataDir)}/unvibe-login.err.log</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** systemd quoting: double quotes with `\`, `"`, `$` and backtick escaped. */
export function systemdQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "$$").replace(/`/g, "'")}"`;
}

/**
 * One systemd `Environment=` line. The whole `NAME=value` assignment is
 * quoted when it needs it (the documented shape), so data dirs with
 * spaces work.
 */
export function systemdEnv(name: string, value: string): string {
  const bare = `${name}=${value}`;
  if (/^[A-Za-z0-9_]+=[A-Za-z0-9_@%+=:,./-]+$/.test(bare)) return `Environment=${bare}`;
  const escaped = bare.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `Environment="${escaped}"`;
}

/** systemd user unit: start at login, restart on failure, never idle-exit. */
export function systemdUnitContent(opts: LoginUnitOpts): string {
  const { nodePath, cliPath, port, dataDir } = opts;
  return [
    "# Generated by `unvibe setup`. Re-run setup after changing the port or data dir.",
    "[Unit]",
    "Description=Unvibe local review service",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${systemdQuote(nodePath)} ${systemdQuote(cliPath)} start --foreground`,
    systemdEnv("UNVIBE_PORT", String(port)),
    systemdEnv("UNVIBE_DATA_DIR", dataDir),
    "Environment=UNVIBE_IDLE_MS=0",
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export interface BakedUnit {
  nodePath: string;
  cliPath: string;
  port: number;
  dataDir: string;
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Split a systemd `ExecStart` tail into shell words (double-quote aware). */
function splitSystemdWords(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') quoted = false;
      else if (c === "\\" && i + 1 < s.length) {
        cur += s[i + 1];
        i++;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === " " || c === "\t") {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
    } else cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function parsePlistUnit(content: string): BakedUnit | null {
  const prog = content.match(
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>([\s\S]*?)<\/string>\s*<string>([\s\S]*?)<\/string>/,
  );
  const port = content.match(/<key>UNVIBE_PORT<\/key>\s*<string>([^<]*)<\/string>/);
  const dataDir = content.match(/<key>UNVIBE_DATA_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/);
  if (!prog || !port || !dataDir) return null;
  const portNum = Number(port[1]);
  if (!Number.isSafeInteger(portNum) || portNum <= 0) return null;
  return {
    nodePath: xmlUnescape(prog[1]),
    cliPath: xmlUnescape(prog[2]),
    port: portNum,
    dataDir: xmlUnescape(dataDir[1]),
  };
}

function parseSystemdUnit(content: string): BakedUnit | null {
  const exec = content.match(/^ExecStart=(.*)$/m);
  if (!exec) return null;
  const words = splitSystemdWords(exec[1].trim());
  if (words.length < 2) return null;
  const env: Record<string, string> = {};
  for (const line of content.match(/^Environment=(.*)$/gm) ?? []) {
    const assignment = line.slice("Environment=".length).trim();
    const unquoted =
      assignment.startsWith('"') && assignment.endsWith('"') && assignment.length >= 2
        ? assignment.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : assignment;
    const eq = unquoted.indexOf("=");
    if (eq > 0) env[unquoted.slice(0, eq)] = unquoted.slice(eq + 1);
  }
  const portNum = Number(env["UNVIBE_PORT"]);
  if (!env["UNVIBE_DATA_DIR"] || !Number.isSafeInteger(portNum) || portNum <= 0) return null;
  return { nodePath: words[0], cliPath: words[1], port: portNum, dataDir: env["UNVIBE_DATA_DIR"] };
}

/**
 * Read back what `setup` baked into the unit (its own generated format).
 * Null when the content is not ours (hand-edited beyond recognition).
 * Round-trip pinned against the builders in `cli/setup/login.ts`.
 */
export function parseLoginUnit(content: string, platform: string): BakedUnit | null {
  const baked = platform === "darwin" ? parsePlistUnit(content) : parseSystemdUnit(content);
  if (!baked || !baked.nodePath || !baked.cliPath || !baked.dataDir) return null;
  return baked;
}

export interface LoginUnitCheck {
  managed: boolean;
  unitPath: string;
  /** Empty when fresh. Each entry names the problem plus the fix. */
  problems: string[];
}

/**
 * Cheap staleness check (Q2): the global npm install under an update can
 * move the installed files (and a Node upgrade moves the node binary, see
 * issue #105), leaving the baked paths behind. Doctor warns; `setup` or
 * an update refreshes.
 */
export function checkLoginUnit(homeDir: string, platform: string): LoginUnitCheck {
  const unitPath = loginUnitPath(homeDir, platform);
  if (!isLoginManaged(homeDir, platform)) return { managed: false, unitPath, problems: [] };
  let content: string;
  try {
    content = fs.readFileSync(unitPath, "utf8");
  } catch {
    return { managed: true, unitPath, problems: [`login unit unreadable at ${unitPath}; re-run \`unvibe setup\``] };
  }
  const baked = parseLoginUnit(content, platform);
  if (!baked) {
    return { managed: true, unitPath, problems: [`login unit at ${unitPath} is not recognizable; re-run \`unvibe setup\``] };
  }
  const problems: string[] = [];
  if (!fs.existsSync(baked.nodePath)) {
    problems.push(`login unit points at node ${baked.nodePath}, which no longer exists (Node moved?); re-run \`unvibe setup\``);
  }
  if (!fs.existsSync(baked.cliPath)) {
    problems.push(`login unit points at ${baked.cliPath}, which no longer exists (reinstall, then re-run \`unvibe setup\`)`);
  }
  return { managed: true, unitPath, problems };
}

export type RefreshUnitOpts = BakedUnit;

/**
 * Rewrite the unit with fresh paths after an update (Q2). Returns true
 * when a managed unit was rewritten, false when unmanaged (nothing to do)
 * or when the paths are unusable. Only the baked values change;
 * crash-only restart and login-start semantics are the builders' above
 * and never drift here.
 */
export function refreshLoginUnitIfManaged(
  homeDir: string,
  platform: string,
  opts: RefreshUnitOpts,
  write: (unitPath: string, content: string) => void = (p, c) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, c);
  },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Real-home guard (#313): refuse before any write under a test marker.
  assertNotRealHomeForWrite({ homeDir, unitPath: loginUnitPath(homeDir, platform), dataDir: opts.dataDir }, env);
  if (!isLoginManaged(homeDir, platform)) return false;
  if (!opts.nodePath || !opts.cliPath || !opts.dataDir) return false;
  const content = platform === "darwin" ? launchdPlistContent(opts) : systemdUnitContent(opts);
  write(loginUnitPath(homeDir, platform), content);
  return true;
}
