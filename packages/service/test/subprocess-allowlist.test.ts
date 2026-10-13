/**
 * Subprocess allowlist (PRD §16 Privacy).
 *
 * The service may spawn only `git`, `gh` (via the GITHUB_TOKEN-unset
 * wrapper), the login shell for PATH resolution, the agent adapters/CLIs,
 * `npm` for `unvibe update` channel installs,
 * and the platform helpers used by `unvibe setup` (`osacompile`,
 * `lsregister`, `xdg-mime`, `update-desktop-database`, `launchctl`
 * (start-at-login agent, issue #108), `systemctl --user` (start-at-login
 * unit, issue #108), `open`/`xdg-open`),
 * the native folder-picker dialogs (`osascript` on macOS,
 * `zenity`/`kdialog` on Linux, #26),
 * plus the service lifecycle itself (spawning its own CLI entry).
 * Every `CommandRunner`/`spawn`/`execFile` call site must resolve to that
 * list (extends the `gh-writes.test.ts` guard pattern). Each entry carries
 * its reason.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "src");

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

// Literal commands the service may spawn, each with its reason.
const ALLOWED_LITERAL: { cmd: string; reason: string }[] = [
  { cmd: "git", reason: "ingest/versions/repos/reviews/worktrees (local git only; fetch is best-effort local)" },
  { cmd: "gh", reason: "GitHub via the GITHUB_TOKEN-unset wrapper (PRD §15); writes only in src/submit" },
  { cmd: "claude", reason: "user's installed agent CLI (login-shell PATH; adapter runs it via CLAUDE_CODE_EXECUTABLE, version-checked by readiness/doctor; Unvibe ships no bundled binary)" },
  { cmd: "codex", reason: "user's installed agent CLI (login-shell PATH; adapter runs it via CODEX_PATH app-server, version-checked by readiness/doctor; Unvibe ships no bundled binary)" },
  { cmd: "d2", reason: "user's installed diagram binary (login-shell PATH or UNVIBE_D2_BIN, version-gated ≥ 0.9.0 by readiness/doctor; stdin-only, --bundle=false, empty temp dir, scrubbed env; Unvibe ships no bundled binary)" },
  { cmd: "npm", reason: "unvibe update installs a channel globally (npm install -g github:<repo>#<channel>); never runs during request handling" },
  { cmd: "osacompile", reason: "unvibe setup on macOS (builds the local helper app)" },
  { cmd: "xdg-mime", reason: "unvibe setup on Linux (registers unvibe://)" },
  { cmd: "update-desktop-database", reason: "unvibe setup on Linux (refreshes desktop entries)" },
  { cmd: "launchctl", reason: "unvibe setup on macOS (bootstrap/bootout the start-at-login agent, issue #108)" },
  { cmd: "systemctl", reason: "unvibe setup on Linux (enable/disable the start-at-login user unit, issue #108)" },
  { cmd: "open", reason: "unvibe open on macOS (opens the app URL)" },
  { cmd: "xdg-open", reason: "unvibe open on Linux (opens the app URL)" },
  { cmd: "osascript", reason: "native folder picker on macOS (choose folder; user cancel reported as cancelled, #26)" },
  { cmd: "zenity", reason: "native folder picker on Linux (preferred dialog; falls back to kdialog, #26)" },
  { cmd: "kdialog", reason: "native folder picker on Linux when zenity is missing (#26)" },
];

const ALLOWED_RE = [
  // runner.run("git"|"gh"|"claude"|"codex"|"osacompile"|...) with a literal.
  /\.run\(\s*"([^"]+)"\s*,/,
  /\.run\(\s*'([^']+)'\s*,/,
  // execFile(cmd, ...) where cmd is the setup runner's variable (setup/index.ts
  // realSetupRunner takes cmd from the allowlisted callers above).
  // spawn(process.execPath, ...) — node running the adapter entry or the
  // service's own CLI entry (lifecycle).
  /spawn\(\s*process\.execPath/,
  // execFile(shell, ...) — login-shell PATH probes (zsh/bash/sh/fish).
  /execFile\(\s*shell\s*,/,
  // LSREGISTER is an absolute path constant (LaunchServices registration).
  /runner\.run\(\s*LSREGISTER/,
];

describe("subprocess allowlist", () => {
  it("every spawn call site resolves to the allowlist", () => {
    const allowedCmds = new Set(ALLOWED_LITERAL.map((a) => a.cmd));
    const offenders: string[] = [];
    for (const file of listTs(srcRoot)) {
      const rel = path.relative(srcRoot, file);
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//")) return;
        if (!/\.run\(\s*["']|execFile\s*\(|spawn\s*\(/.test(line)) return;
        // Allowlisted shapes first.
        if (/spawn\(\s*process\.execPath/.test(line)) return; // node: adapter entry / service lifecycle
        if (/execFile\(\s*shell\s*,/.test(line)) return; // login-shell PATH probe
        if (/runner\.run\(\s*LSREGISTER/.test(line)) return; // lsregister absolute path
        if (/realSetupRunner|SetupRunner/.test(line) && /execFile\(\s*cmd/.test(line)) return; // setup dispatcher
        // Literal `.run("cmd", ...)`: only CommandRunner calls (via a
        // runner/commands variable) spawn subprocesses. SQLite
        // (`db.prepare(...).run("demo", ...)`, `stmt.run(...)`) is not a
        // subprocess and is ignored here.
        const m = line.match(/\.run\(\s*["']([^"']+)["']\s*,/);
        if (m) {
          if (!/runner|commands/.test(line)) return; // SQLite, not a subprocess.
          if (!allowedCmds.has(m[1])) offenders.push(`${rel}:${i + 1}: spawns "${m[1]}"`);
          return;
        }
        // Dynamic command (variable): only allowed in the known dispatchers.
        if (/\.run\(\s*(cmd|shell|opener|LSREGISTER|bin\.path|opts\.binPath|binPath|raw|p)\b/.test(line)) {
          if (/cli\/setup|cli\/commands/.test(rel)) return;
          // readiness version probes run the resolved user CLI (absolute path
          // from login-shell PATH or UNVIBE_*_BIN override; never a bundle).
          if (/readiness\/checks/.test(rel) && /bin\.path/.test(line)) return;
          // D2 renders run the resolved user binary (absolute path from
          // login-shell PATH or UNVIBE_D2_BIN; stdin-only, --bundle=false,
          // empty temp dir, scrubbed env; never a bundle).
          if (/diagrams\/render/.test(rel) && /binPath/.test(line)) return;
          // Diagnostics tool probes run the resolved user CLI (absolute path
          // from the effective PATH or UNVIBE_*_BIN override; --version only,
          // timeout-guarded; never a bundle) — issue #20.
          if (/diagnostics\/tools/.test(rel) && /runner\.run\(\s*binPath/.test(line)) return;
          if (/diagnostics\/tools/.test(rel) && /runner\.run\(\s*(raw|p)\b/.test(line)) return;
          // Shim resolution asks the version manager for the real path
          // behind a shim (`mise which`/`asdf which`, read-only, from the
          // home directory, timeout-guarded; never trusts config) — issue #105.
          if (/exec\/shim-resolve/.test(rel) && /runner\.run\(\s*managerBin\b/.test(line)) return;
          offenders.push(`${rel}:${i + 1}: dynamic spawn ${line.trim().slice(0, 80)}`);
          return;
        }
        if (/execFile\s*\(\s*(cmd|shell)\b/.test(line)) {
          if (/cli\/setup|cli\/doctor|diagnostics\/path-probe/.test(rel)) return;
          offenders.push(`${rel}:${i + 1}: dynamic execFile ${line.trim().slice(0, 80)}`);
          return;
        }
        if (/spawn\s*\(/.test(line) && !/process\.execPath/.test(line)) {
          // cli/commands.ts spawns the opener (open/xdg-open variable) + the
          // service entry (process.execPath, handled above).
          if (/cli\/commands/.test(rel) && /opener/.test(line)) return;
          if (/exec\/runner/.test(rel) && /spawn\(\s*cmd/.test(line)) return; // RealCommandRunner dispatcher
          offenders.push(`${rel}:${i + 1}: spawn ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, "subprocess spawns outside the allowlist (see reasons in this test)").toEqual([]);
    expect(ALLOWED_LITERAL.length).toBeGreaterThan(0);
    void ALLOWED_RE;
  });

  it("documents the allowlist reasons", () => {
    for (const a of ALLOWED_LITERAL) {
      expect(a.reason.length).toBeGreaterThan(10);
    }
  });
});
