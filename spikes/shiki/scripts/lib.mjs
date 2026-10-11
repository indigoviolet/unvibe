/**
 * Shared harness for the Shiki spike (issue #23). Everything runs on
 * loopback; every spawned process is tracked by PID and killed by PID
 * (never by pattern). `GITHUB_TOKEN` is stripped for child services.
 */
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..", "..");
export const OUT = path.join(here, "..", "out");

export async function git(cwd, ...args) {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

export function tmpdir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmdir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Kill by PID with SIGTERM, then SIGKILL after a grace period. */
export async function killPid(pid, label = "proc") {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // gone
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // gone
  }
  console.log(`[harness] ${label} pid=${pid} killed`);
}

async function waitFor(url, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`never reachable: ${url}`);
}

/** Spawn mock-mode Vite for packages/web on a fixed port. Returns { url, pid }. */
export async function startMockWeb(port) {
  const proc = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: path.join(ROOT, "packages", "web"),
    env: { ...process.env, VITE_MOCK: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});
  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/`);
  console.log(`[harness] mock web up at ${url} pid=${proc.pid}`);
  return { url, pid: proc.pid };
}

/** Spawn the built service (agent=none). Returns { origin, token, pid }. */
export async function startService(dataDir) {
  const entry = path.join(ROOT, "packages", "service", "dist", "index.js");
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  const proc = spawn(process.execPath, [entry], {
    env: {
      ...env,
      UNVIBE_DATA_DIR: dataDir,
      UNVIBE_PORT: "0",
      UNVIBE_REPO_ROOTS: "",
      UNVIBE_AGENT: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start: ${out.slice(-500)}`)), 30000);
    proc.stdout?.on("data", (d) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.stderr?.on("data", () => {});
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited ${code}: ${out.slice(-500)}`));
      }
    });
  });
  const { origin, token } = await started;
  console.log(`[harness] service up at ${origin} pid=${proc.pid}`);
  return { origin, token, pid: proc.pid };
}

export async function apiJson(origin, token, method, urlPath, body) {
  const res = await fetch(`${origin}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Create a branch review for a scratch repo; returns the review id. */
export async function createBranchReview(origin, token, repoPath, branch) {
  const added = await apiJson(origin, token, "POST", "/api/repos", { path: repoPath });
  const repos = added.repos ?? [];
  const repo = repos.find((r) => r.localPath === repoPath) ?? repos[repos.length - 1];
  if (!repo) throw new Error("repo not registered");
  const created = await apiJson(origin, token, "POST", "/api/reviews", { repoId: repo.id, branch });
  return created.review?.id ?? created.id;
}

// --- scratch repos ---------------------------------------------------------

async function commitAll(dir, msg) {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", msg);
}

const PY_BASE = `"""Multi-language fixture base."""
import os


def helper(name):
    # greet by name
    return "hello " + name


class Store:
    """Tiny docstring store."""

    def __init__(self):
        self.items = {}
`;
const PY_NEXT = `"""Multi-language fixture branch."""
import os
import sys


def helper(name, punct="!"):
    # greet by name, with punctuation
    greeting = f"hello {name}{punct}"
    return greeting.strip()


def second(items):
    """Return the second item when present."""
    if len(items) > 1:
        return items[1]
    return None


class Store:
    """Tiny docstring store."""

    def __init__(self):
        self.items = {}

    def put(self, key, value):
        self.items[key] = value
        return value
`;

const TS_BASE = `export interface Item {
  id: number;
  label: string;
}

export function first(items: Item[]): Item | undefined {
  return items[0];
}
`;
const TS_NEXT = `export interface Item {
  id: number;
  label: string;
  tags?: string[];
}

export function first(items: Item[]): Item | undefined {
  // fast path for the common single-item list
  if (items.length === 1) return items[0];
  return items.find((i) => i.label !== "");
}

export async function load(url: string): Promise<Item[]> {
  const res = await fetch(url);
  return (await res.json()) as Item[];
}
`;

const TSX_BASE = `export function Button({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}
`;
const TSX_NEXT = `import { useState } from "react";

export function Button({ label, hint }: { label: string; hint?: string }) {
  const [count, setCount] = useState(0);
  // clicks accumulate until reset
  return (
    <button type="button" title={hint ?? label} onClick={() => setCount((c) => c + 1)}>
      {label}: {count}
    </button>
  );
}
`;

const MD_BASE = `# Fixture\n\nSome intro text with \`inline code\`.\n`;
const MD_NEXT = `# Fixture\n\nSome intro text with \`inline code\` and **bold**.\n\n## Added section\n\n- one\n- two\n\n\`\`\`python\nprint("fenced block")\n\`\`\`\n`;

const JSON_BASE = `{"name": "fixture", "private": true}
`;
const JSON_NEXT = `{"name": "fixture", "private": true, "version": "0.0.2", "scripts": {"test": "vitest run"}}
`;

const SH_BASE = `#!/bin/bash\n# base script\necho "start"\n`;
const SH_NEXT = `#!/bin/bash\n# branch script: greet with args\nset -euo pipefail\necho "start $*"\nfor arg in "$@"; do\n  echo "got $arg"\ndone\n`;

const RST_TEXT = `Fixture changelog entry
=======================

Fixes a thing. See issue 23.
`;

/** Scratch repo with one changed file per shipped language + unshipped ones. */
export async function makeMultiLangRepo() {
  const dir = tmpdir("unvibe-shiki-multilang-");
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "app.py"), PY_BASE);
  writeFileSync(path.join(dir, "src", "index.ts"), TS_BASE);
  writeFileSync(path.join(dir, "src", "widget.tsx"), TSX_BASE);
  writeFileSync(path.join(dir, "README.md"), MD_BASE);
  writeFileSync(path.join(dir, "config.json"), JSON_BASE);
  writeFileSync(path.join(dir, "run.sh"), SH_BASE);
  writeFileSync(path.join(dir, "notes.rst"), RST_TEXT);
  await commitAll(dir, "base");
  await git(dir, "checkout", "-b", "feature");
  writeFileSync(path.join(dir, "src", "app.py"), PY_NEXT);
  writeFileSync(path.join(dir, "src", "index.ts"), TS_NEXT);
  writeFileSync(path.join(dir, "src", "widget.tsx"), TSX_NEXT);
  writeFileSync(path.join(dir, "README.md"), MD_NEXT);
  writeFileSync(path.join(dir, "config.json"), JSON_NEXT);
  writeFileSync(path.join(dir, "run.sh"), SH_NEXT);
  writeFileSync(path.join(dir, "notes.rst"), `${RST_TEXT}\nSecond paragraph.\n`);
  await commitAll(dir, "feature work");
  return dir;
}

const EXTS = ["py", "ts", "tsx", "js", "json", "md", "sh", "rs"];

/** 300-file / ~5k-hunk scratch repo. `files` count, `regions` hunks each. */
export async function makeLargeRepo(files = 300, regions = 17) {
  const dir = tmpdir("unvibe-shiki-large-");
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  const LINES_PER_REGION = 9; // changed lines land >7 apart -> separate hunks
  for (let fi = 0; fi < files; fi++) {
    const ext = EXTS[fi % EXTS.length];
    const sub = `pkg${Math.floor(fi / 50)}`;
    mkdirSync(path.join(dir, "src", sub), { recursive: true });
    const out = [];
    for (let r = 0; r < regions; r++) {
      out.push(`# region ${r} of file ${fi}`);
      for (let k = 0; k < LINES_PER_REGION; k++) out.push(`line_${r}_${k} = ${fi * 1000 + r * 10 + k}`);
    }
    writeFileSync(path.join(dir, "src", sub, `file-${fi}.${ext}`), `${out.join("\n")}\n`);
  }
  await commitAll(dir, "base with many files");
  await git(dir, "checkout", "-b", "feature");
  for (let fi = 0; fi < files; fi++) {
    const ext = EXTS[fi % EXTS.length];
    const sub = `pkg${Math.floor(fi / 50)}`;
    const p = path.join(dir, "src", sub, `file-${fi}.${ext}`);
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(p, "utf8").split("\n");
    // Rewrite the middle line of every region (keeps 4 ctx lines each side).
    const per = LINES_PER_REGION + 1;
    for (let r = 0; r < regions; r++) {
      const idx = r * per + 1 + 4;
      if (idx < lines.length) lines[idx] = `line_${r}_4 = ${(fi + 1) * 1000 + r * 10 + 4}  # changed`;
    }
    writeFileSync(p, `${lines.join("\n")}`);
  }
  await commitAll(dir, "feature touches every file");
  return dir;
}
