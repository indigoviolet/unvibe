/**
 * `unvibe doctor`: environment checks (PRD §14 install path).
 *
 * Informational: always exits 0, marking each check ok / missing / warn so
 * a fresh machine without agent CLIs still reports cleanly. `gh` is probed
 * with `GITHUB_TOKEN` unset (PRD §15) so a scoped token in the environment
 * can neither help nor break the check.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { resolveLoginShellPath } from "../exec/shell-path.js";

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

/** Minimal `command -v`: search PATH for an executable file. */
export function findOnPath(name: string, pathValue: string = process.env.PATH ?? ""): string | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const candidates = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of dirs) {
    for (const c of candidates) {
      const full = path.join(dir, c);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        const st = fs.statSync(full);
        if (st.isFile()) return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

async function toolVersion(cmd: string, args: string[]): Promise<string | null> {
  if (!findOnPath(cmd)) return null;
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

/** `gh auth status` with GITHUB_TOKEN unset (PRD §15). Exported for tests. */
export async function ghAuthStatus(): Promise<{ present: boolean; loggedIn: boolean; detail: string }> {
  const bin = findOnPath("gh");
  if (!bin) return { present: false, loggedIn: false, detail: "gh not on PATH" };
  const env = { ...process.env, GITHUB_TOKEN: undefined } as NodeJS.ProcessEnv;
  delete env.GITHUB_TOKEN;
  const r = await execTimeout("gh", ["auth", "status"], { env });
  if (r.code === 0) {
    const first = (r.stdout + "\n" + r.stderr).split("\n").find((l) => l.trim()) ?? "logged in";
    return { present: true, loggedIn: true, detail: first.trim() };
  }
  return { present: true, loggedIn: false, detail: "gh present but not logged in (gh auth login)" };
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

  const git = await toolVersion("git", ["--version"]);
  checks.push({ name: "git", status: git ? "ok" : "fail", detail: git ?? "not on PATH" });

  const gh = await ghAuthStatus();
  checks.push({
    name: "gh",
    status: !gh.present ? "fail" : gh.loggedIn ? "ok" : "warn",
    detail: gh.detail,
  });

  for (const agent of ["claude", "codex"]) {
    const v = await toolVersion(agent, ["--version"]);
    checks.push({ name: agent, status: v ? "ok" : "warn", detail: v ?? `not on PATH (needed for ${agent} agent sessions)` });
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
  checks.push({
    name: "port",
    status: "ok",
    detail: taken ? `${opts.port} is in use (service may already run: unvibe status)` : `${opts.port} is free`,
  });

  return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((c) => `[${c.status}] ${c.name}: ${c.detail}`).join("\n");
}
