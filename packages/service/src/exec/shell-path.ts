/**
 * macOS gotcha (PRD §14): apps opened from Finder don't inherit the shell's
 * PATH. On startup the service reads it from a login shell so it can find
 * `gh`, `git`, `claude`, `codex` and mise-installed tools.
 */
import { execFile } from "node:child_process";

function shellCandidates(): string[] {
  if (process.platform === "win32") return [];
  // Respect the user's shell; zsh is the macOS default.
  const shell = process.env.SHELL;
  const list = shell ? [shell] : [];
  for (const s of ["/bin/zsh", "/bin/bash"]) {
    if (!list.includes(s)) list.push(s);
  }
  return list;
}

function echoPathWith(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(shell, ["-lc", "echo $PATH"], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const p = stdout.trim();
      resolve(p || null);
    });
  });
}

/** Best-effort login-shell PATH; falls back to the current PATH. */
export async function resolvePathFromLoginShell(): Promise<string> {
  for (const shell of shellCandidates()) {
    try {
      const p = await echoPathWith(shell);
      if (p) return p;
    } catch {
      // try the next shell
    }
  }
  return process.env.PATH ?? "";
}
