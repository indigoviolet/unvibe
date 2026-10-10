/**
 * `unvibe doctor`: environment checks (PRD §14 install path).
 *
 * Informational: always exits 0, marking each check ok / missing / warn so
 * a fresh machine without agent CLIs still reports cleanly. `gh` is probed
 * with `GITHUB_TOKEN` unset (PRD §15) so a scoped token in the environment
 * can neither help nor break the check.
 *
 * Shared checks (PATH lookup, `gh` auth, `git` version) live in
 * `../readiness/checks.js` so `GET /api/readiness` reuses the same logic.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { isHealthOk } from "./lock.js";
import { resolveLoginShellPath } from "../exec/shell-path.js";
import {
  agentBinSpec,
  meetsMinVersion,
  parseVersion,
  resolveAgentBin,
} from "../exec/agent-bins.js";
import {
  findOnPath as sharedFindOnPath,
  ghAuthStatus as sharedGhAuth,
  gitVersion as sharedGitVersion,
} from "../readiness/checks.js";
import { RealCommandRunner } from "../exec/runner.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function execTimeout(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeoutMs ?? 10_000, env: opts.env ?? process.env }, (err, stdout, stderr) => {
      resolve({
        code: err ? 1 : 0,
        stdout: String(stdout ?? "").trim(),
        stderr: String(stderr ?? "").trim(),
      });
    });
  });
}

/** Minimal `command -v` (shared with readiness; re-exported for compat). */
export function findOnPath(name: string, pathValue: string = process.env.PATH ?? ""): string | null {
  return sharedFindOnPath(name, pathValue);
}

async function toolVersion(cmd: string, args: string[]): Promise<string | null> {
  // Absolute paths (resolved bins) run directly; bare names need a PATH hit.
  if (!cmd.includes("/") && !sharedFindOnPath(cmd)) return null;
  const r = await execTimeout(cmd, args);
  if (r.code !== 0) return null;
  return r.stdout.split("\n")[0];
}

function portTaken(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (taken: boolean): void => {
      sock.destroy();
      resolve(taken);
    };
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
    sock.setTimeout(timeoutMs);
  });
}

/**
 * `gh auth status` with GITHUB_TOKEN unset (PRD §15). Shared with
 * readiness (see `../readiness/checks.js`); kept here for compat.
 */
export async function ghAuthStatus(): Promise<{ present: boolean; loggedIn: boolean; detail: string }> {
  return sharedGhAuth(new RealCommandRunner());
}

export interface DoctorOptions {
  port: number;
  dataDir: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= 24 ? "ok" : "fail",
    detail: `${process.version} (need >= 24 for node:sqlite) at ${process.execPath}`,
  });

  const runner = new RealCommandRunner();
  const git = (await sharedGitVersion(runner)) ?? (await toolVersion("git", ["--version"]));
  checks.push({ name: "git", status: git ? "ok" : "fail", detail: git ?? "not on PATH" });

  const gh = await ghAuthStatus();
  checks.push({
    name: "gh",
    status: !gh.present ? "fail" : gh.loggedIn ? "ok" : "warn",
    detail: gh.detail,
  });

  // Agent CLIs: report the exact executable the adapter will run (path +
  // version) and whether it meets the adapter's minimum. Missing → how to
  // install (Unvibe never installs them). Login state is probed by readiness
  // (listModels); doctor stays token-free and only checks presence+version.
  const loginPathForAgents = (await resolveLoginShellPath().catch(() => null))?.merged ?? process.env.PATH ?? "";
  for (const agent of ["claude", "codex"] as const) {
    const spec = agentBinSpec(agent);
    const bin = resolveAgentBin(agent, { pathValue: loginPathForAgents });
    if (!bin) {
      checks.push({
        name: agent,
        status: "warn",
        detail: `not on login-shell PATH. ${spec.installHint}`,
      });
      continue;
    }
    const raw = await toolVersion(bin.path, ["--version"]);
    const ver = raw ? parseVersion(raw) : null;
    if (ver && !meetsMinVersion(agent, ver)) {
      checks.push({
        name: agent,
        status: "warn",
        detail: `${spec.cli} ${ver} at ${bin.path} (via ${bin.source}); Unvibe needs ≥ ${spec.minVersion}. ${spec.updateHint}`,
      });
    } else if (raw) {
      checks.push({
        name: agent,
        status: "ok",
        detail: `${raw} at ${bin.path} (via ${bin.source})`,
      });
    } else {
      checks.push({
        name: agent,
        status: "warn",
        detail: `found at ${bin.path} (via ${bin.source}) but --version failed; ensure ${spec.cli} runs and is logged in`,
      });
    }
  }

  try {
    const login = await resolveLoginShellPath();
    checks.push({
      name: "login-shell PATH",
      status: login ? "ok" : "warn",
      detail: login
        ? `from ${login.shell}: ${login.merged}`
        : "no login shell answered; using inherited PATH",
    });
  } catch (err) {
    checks.push({ name: "login-shell PATH", status: "warn", detail: String(err) });
  }

  try {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    fs.accessSync(opts.dataDir, fs.constants.W_OK);
    checks.push({ name: "data dir", status: "ok", detail: `${opts.dataDir} (writable)` });
  } catch (err) {
    checks.push({ name: "data dir", status: "fail", detail: `${opts.dataDir}: ${String(err)}` });
  }

  const taken = await portTaken(opts.port);
  if (!taken) {
    checks.push({ name: "port", status: "ok", detail: `${opts.port} is free` });
  } else if (await isHealthOk(opts.port)) {
    // Our own service (or another Unvibe with the same data dir layout):
    // the default port stays stable so the installed PWA keeps working.
    checks.push({ name: "port", status: "ok", detail: `${opts.port} is in use by an Unvibe service (unvibe status)` });
  } else {
    checks.push({
      name: "port",
      status: "warn",
      detail: `${opts.port} is in use by something else; set UNVIBE_PORT to a free port (the installed web app is bound to its origin, so reinstall it after changing ports)`,
    });
  }

  return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((c) => `[${c.status}] ${c.name}: ${c.detail}`).join("\n");
}
