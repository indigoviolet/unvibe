/**
 * Safe D2 rendering (docs/diagram-options.md §7, "subprocess hygiene").
 *
 * - Source via **stdin only** (`d2 … - -`), SVG on stdout. Never via files.
 * - Empty temporary working directory per render (relative imports resolve
 *   to nothing).
 * - Timeout, input byte cap, output byte cap, concurrency limit.
 * - Deterministic flags: `--layout dagre --pad 20 --no-xml-tag
 *   --bundle=false`, no sketch, no animation. Theme `0` (light) / `200`
 *   (dark). `--salt <hash>` namespaces ids per diagram.
 * - `--bundle=false` disables asset bundling/fetching; the pre-check
 *   already rejected `icon:`/image/import sources. The subprocess env is
 *   scrubbed with bogus proxy vars as defence-in-depth.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeD2Source, D2_RENDER_OPTIONS } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { precheckD2Source } from "./precheck.js";

export const D2_INPUT_BYTE_CAP = 64 * 1024;
export const D2_OUTPUT_BYTE_CAP = 512 * 1024;
export const D2_TIMEOUT_MS = 15_000;
export const D2_MAX_CONCURRENCY = 2;

export const D2_THEME_LIGHT = 0;
export const D2_THEME_DARK = 200;

let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (inFlight < D2_MAX_CONCURRENCY) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function release(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

export interface RenderOpts {
  runner: CommandRunner;
  /** Absolute path to the `d2` binary. */
  binPath: string;
  /** Content hash (used as `--salt` for id namespacing). */
  salt: string;
  theme: typeof D2_THEME_LIGHT | typeof D2_THEME_DARK;
  timeoutMs?: number;
}

export interface RenderResult {
  ok: boolean;
  svg?: string;
  error?: string;
}

/** Scrubbed env: minimal PATH, bogus proxies, no tokens. */
function sandboxEnv(): Record<string, string | undefined> {
  return {
    PATH: "/usr/bin:/bin",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    all_proxy: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    D2_BUNDLE: "false",
    GITHUB_TOKEN: undefined,
  };
}

/**
 * Render one theme. Returns `{ ok, svg }` or `{ ok: false, error }`.
 * Pre-check failures, input caps, timeouts, and byte caps are all errors
 * with one-line messages suitable for the repair prompt.
 */
export async function renderD2Theme(source: string, opts: RenderOpts): Promise<RenderResult> {
  const canon = canonicalizeD2Source(source);
  if (Buffer.byteLength(canon, "utf8") > D2_INPUT_BYTE_CAP) {
    return { ok: false, error: `diagram source exceeds ${D2_INPUT_BYTE_CAP} bytes` };
  }
  const pre = precheckD2Source(canon);
  if (!pre.ok) return { ok: false, error: pre.reason };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
  await acquire();
  try {
    const args = [
      `--layout=${D2_RENDER_OPTIONS.layout}`,
      `--pad=${D2_RENDER_OPTIONS.pad}`,
      `--theme=${opts.theme}`,
      `--salt=${opts.salt}`,
      "--no-xml-tag",
      "--bundle=false",
      "-",
      "-",
    ];
    let res;
    try {
      res = await opts.runner.run(opts.binPath, {
        args,
        cwd: tmpDir,
        env: sandboxEnv(),
        stdin: canon,
        timeoutMs: opts.timeoutMs ?? D2_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, error: `d2 failed to run: ${(e as Error).message}` };
    }
    const out = res.stdout;
    if (res.code !== 0) {
      const msg = `${res.stderr}\n${res.stdout}`.split("\n").find((l) => l.trim()) ?? `d2 exited ${res.code}`;
      return { ok: false, error: msg.slice(0, 500) };
    }
    if (Buffer.byteLength(out, "utf8") > D2_OUTPUT_BYTE_CAP) {
      return { ok: false, error: `rendered SVG exceeds ${D2_OUTPUT_BYTE_CAP} bytes` };
    }
    if (!out.includes("<svg")) {
      const msg = `${res.stderr}`.split("\n").find((l) => l.trim()) ?? "d2 produced no SVG";
      return { ok: false, error: msg.slice(0, 500) };
    }
    return { ok: true, svg: out };
  } finally {
    release();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/**
 * Compile-check via `d2 validate -` (stdin). Fast; no SVG output.
 * Returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function checkD2Source(
  source: string,
  opts: { runner: CommandRunner; binPath: string; timeoutMs?: number },
): Promise<{ ok: boolean; error?: string }> {
  const canon = canonicalizeD2Source(source);
  if (Buffer.byteLength(canon, "utf8") > D2_INPUT_BYTE_CAP) {
    return { ok: false, error: `diagram source exceeds ${D2_INPUT_BYTE_CAP} bytes` };
  }
  const pre = precheckD2Source(canon);
  if (!pre.ok) return { ok: false, error: pre.reason };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
  await acquire();
  try {
    let res;
    try {
      res = await opts.runner.run(opts.binPath, {
        args: ["validate", "-"],
        cwd: tmpDir,
        env: sandboxEnv(),
        stdin: canon,
        timeoutMs: opts.timeoutMs ?? D2_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, error: `d2 failed to run: ${(e as Error).message}` };
    }
    if (res.code === 0) return { ok: true };
    const msg = `${res.stderr}\n${res.stdout}`.split("\n").find((l) => l.trim()) ?? `d2 validate exited ${res.code}`;
    return { ok: false, error: msg.slice(0, 500) };
  } finally {
    release();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/** Probe `d2 --version` → `x.y.z` or null. Never throws. */
export async function probeD2Version(
  runner: CommandRunner,
  binPath: string,
  timeoutMs = 8000,
): Promise<string | null> {
  try {
    const r = await runner.run(binPath, { args: ["--version"], timeoutMs });
    if (r.code !== 0) return null;
    const m = `${r.stdout}\n${r.stderr}`.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  } catch {
    return null;
  }
}
