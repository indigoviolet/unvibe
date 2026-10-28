/**
 * Safe D2 rendering (docs/d2-diagrams.md).
 *
 * - Source via **stdin only** (`d2 … - -`), SVG on stdout. Never via files.
 * - Empty temporary working directory per render (relative imports resolve
 *   to nothing).
 * - Timeout, input byte cap, output byte cap, concurrency limit.
 * - Deterministic flags: `--layout dagre --pad 20 --no-xml-tag
 *   --bundle=false`, no sketch, no animation. Theme `0` (light) / `200`
 *   (dark). `--salt <hash>` namespaces ids per diagram.
 * - `--bundle=false` disables asset bundling/fetching; allowlisted icons
 *   are pre-fetched and staged by the caller (see `stageIcons`), so the
 *   binary only ever reads staged local files. The subprocess env is
 *   scrubbed with bogus proxy vars as defence-in-depth.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalizeD2Source, D2_RENDER_OPTIONS } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { defaultFetchIcon, stageIcons, type IconFetcher, type IconStrip } from "./icons.js";
import { precheckD2Source, renameReservedShapeKeys } from "./precheck.js";

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
  /** Icon fetcher (issue #286). Defaults to the real network fetch. */
  fetchIcon?: IconFetcher;
}

export interface RenderResult {
  ok: boolean;
  svg?: string;
  error?: string;
  /** Icons stripped (fetch failed) instead of rendered, with reasons. */
  iconNotes: IconStrip[];
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
  // Unambiguous reserved-word shapes (`steps: "label"`) are renamed to
  // `steps_box` before checking, so the binary sees the fixed source.
  const canon = renameReservedShapeKeys(canonicalizeD2Source(source)).source;
  if (Buffer.byteLength(canon, "utf8") > D2_INPUT_BYTE_CAP) {
    return { ok: false, error: `diagram source exceeds ${D2_INPUT_BYTE_CAP} bytes`, iconNotes: [] };
  }
  const pre = precheckD2Source(canon);
  if (!pre.ok) return { ok: false, error: pre.reason, iconNotes: [] };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
  // Allowlisted icons are pre-fetched and staged here, then rewritten to
  // the staged files (d2 embeds local files as `data:` even with
  // `--bundle=false`, so it never fetches). Failures strip the icon and
  // are recorded — the diagram still renders.
  const staged = await stageIcons(canon, { fetcher: opts.fetchIcon ?? defaultFetchIcon, dir: tmpDir });
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
        stdin: staged.source,
        timeoutMs: opts.timeoutMs ?? D2_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, error: `d2 failed to run: ${(e as Error).message}`, iconNotes: staged.stripped };
    }
    const out = res.stdout;
    if (res.code !== 0) {
      const msg = `${res.stderr}\n${res.stdout}`.split("\n").find((l) => l.trim()) ?? `d2 exited ${res.code}`;
      return { ok: false, error: msg.slice(0, 500), iconNotes: staged.stripped };
    }
    if (Buffer.byteLength(out, "utf8") > D2_OUTPUT_BYTE_CAP) {
      return { ok: false, error: `rendered SVG exceeds ${D2_OUTPUT_BYTE_CAP} bytes`, iconNotes: staged.stripped };
    }
    if (!out.includes("<svg")) {
      const msg = `${res.stderr}`.split("\n").find((l) => l.trim()) ?? "d2 produced no SVG";
      return { ok: false, error: msg.slice(0, 500), iconNotes: staged.stripped };
    }
    return { ok: true, svg: out, iconNotes: staged.stripped };
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
 * Allowlisted icons are staged first (like the render path) so validate
 * never triggers a network fetch either. Returns `{ ok: true }` or
 * `{ ok: false, error }`.
 */
export async function checkD2Source(
  source: string,
  opts: { runner: CommandRunner; binPath: string; timeoutMs?: number; fetchIcon?: IconFetcher },
): Promise<{ ok: boolean; error?: string }> {
  const canon = renameReservedShapeKeys(canonicalizeD2Source(source)).source;
  if (Buffer.byteLength(canon, "utf8") > D2_INPUT_BYTE_CAP) {
    return { ok: false, error: `diagram source exceeds ${D2_INPUT_BYTE_CAP} bytes` };
  }
  const pre = precheckD2Source(canon);
  if (!pre.ok) return { ok: false, error: pre.reason };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-d2-"));
  const staged = await stageIcons(canon, { fetcher: opts.fetchIcon ?? defaultFetchIcon, dir: tmpDir });
  await acquire();
  try {
    let res;
    try {
      res = await opts.runner.run(opts.binPath, {
        args: ["validate", "-"],
        cwd: tmpDir,
        env: sandboxEnv(),
        stdin: staged.source,
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
