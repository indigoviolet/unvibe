/**
 * Injectable command runner. All `git`/`gh` subprocess use goes through this
 * so tests can stub it with `FakeCommandRunner` — tests never hit real
 * GitHub (AGENTS.md).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
/**
 * Tracing seam (issue #356) without the OTel dependency: the update
 * helper bundles this file (see the helper-bundle containment test),
 * so it must import nothing beyond node builtins. The service fills in
 * the real backend at startup via `setExecTraceSink`; without it every
 * span is a no-op and recording costs one null check.
 */
export interface ExecSpan {
  end(extra?: Record<string, string | number | boolean>): void;
}

export interface ExecTraceSink {
  startSpan(name: string, attrs: Record<string, string | number | boolean>): ExecSpan;
}

const NOOP_SPAN: ExecSpan = {
  end() {},
};

let activeSink: ExecTraceSink | null = null;

/** Filled in by the service composition root; null keeps tracing off. */
export function setExecTraceSink(sink: ExecTraceSink | null): void {
  activeSink = sink;
}

const SAFE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface RunOptions {
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandRunner {
  run(cmd: string, opts: RunOptions): Promise<RunResult>;
}

/** Real implementation: spawn and collect stdio. */
export class RealCommandRunner implements CommandRunner {
  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    // Opt-in performance traces (issue #356): one `exec` span per child
    // process. The raw recording may contain the full argv; the export
    // scrubber keeps the command basename only. A no-op while off.
    const base = path.basename(cmd);
    const span = activeSink
      ? activeSink.startSpan(`exec ${SAFE_COMMAND.test(base) ? base : "other"}`, {
          "exec.cmd": cmd,
          "exec.argv": opts.args.join(" ").slice(0, 4000),
        })
      : NOOP_SPAN;
    try {
      // A missing cwd surfaces from spawn as a bare ENOENT, which reads as
      // "command not found". Say which directory is gone (usually a moved or
      // deleted checkout) before spawning.
      if (opts.cwd !== undefined) {
        try {
          const st = fs.statSync(opts.cwd);
          if (!st.isDirectory()) throw new Error(`not a directory: ${opts.cwd}`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT" || /not a directory/.test((err as Error).message)) {
            throw new Error(
              `cannot run ${cmd}: directory not found: ${opts.cwd} (was the repo moved or deleted? Remove it in Settings → Repos and add it again)`,
            );
          }
          throw err;
        }
      }
      const result = await new Promise<RunResult>((resolve, reject) => {
        const child = spawn(cmd, opts.args, {
          cwd: opts.cwd,
          env: { ...process.env, ...opts.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", reject);
        const timer =
          opts.timeoutMs !== undefined
            ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
            : undefined;
        if (opts.stdin !== undefined) {
          child.stdin.write(opts.stdin);
          child.stdin.end();
        }
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? 1 });
        });
      });
      span.end({ "exec.code": result.code });
      return result;
    } catch (err) {
      span.end();
      throw err;
    }
  }
}

export interface ScriptedResult extends RunResult {
  /** Match on exact command + args; first matching entry wins (FIFO). */
  cmd: string;
  args?: string[];
}

/**
 * Scripted fake: queue expected results. Unmatched commands throw so tests
 * fail loudly instead of silently passing.
 */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: { cmd: string; opts: RunOptions }[] = [];
  private queue: ScriptedResult[] = [];

  enqueue(result: ScriptedResult): void {
    this.queue.push(result);
  }

  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    this.calls.push({ cmd, opts });
    const i = this.queue.findIndex(
      (q) =>
        q.cmd === cmd &&
        (q.args === undefined ||
          (q.args.length === opts.args.length && q.args.every((a, j) => a === opts.args[j]))),
    );
    if (i < 0) throw new Error(`FakeCommandRunner: unexpected command: ${cmd} ${opts.args.join(" ")}`);
    const [found] = this.queue.splice(i, 1);
    return { stdout: found.stdout, stderr: found.stderr, code: found.code };
  }
}

/**
 * Basenames that must never be spawned by the unit suite: the GitHub CLI
 * and the agent CLIs (including pi, issue #279). Tests reach GitHub only
 * through the Submit path (always faked) and reach agents only through an
 * injected `AgentRunner`.
 */
const TEST_BLOCKED_COMMANDS = new Set(["gh", "claude", "codex", "pi"]);

/**
 * True when `candidate` lives inside `dir` (both resolved, symlinks
 * followed best-effort). Guards the harness-fake check below against
 * `..` escapes and `/tmp` vs `/private/tmp` aliases.
 */
function isInsideDir(candidate: string, dir: string): boolean {
  const resolve = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const rel = path.relative(resolve(dir), resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** First executable `name` on `pathValue`, or null. Node builtins only
 * (this file is bundled into the update helper, see above). */
function findExecutableOnPath(name: string, pathValue: string): string | null {
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Test backstop for the injectable command runner (issue #119): refuses
 * the blocked commands loudly instead of spawning the developer's real
 * tools, and delegates everything else (`git`, login shells, `d2`, …) to
 * the wrapped runner. Used as the `buildApp` default under vitest so a
 * test that forgets to inject a `FakeCommandRunner` fails with "inject a
 * fake" instead of hitting the network. Explicitly injected runners
 * (including `RealCommandRunner`) are never wrapped.
 *
 * Issue #370: under `UNVIBE_TEST` (every test-spawned service, vitest or
 * Playwright) `gh` and `git` are additionally confined to the harness
 * fake bin dir (`UNVIBE_TEST_BIN_DIR`, set by the e2e harness): any `gh`
 * or `git` binary resolving outside it is refused loudly — even when the
 * inherited PATH was polluted (e.g. a malformed fake-shell probe letting
 * the real login PATH through). Agent CLIs stay fully blocked as before.
 */
export class TestCommandGuard implements CommandRunner {
  constructor(
    private readonly inner: CommandRunner = new RealCommandRunner(),
    private readonly opts: { testBinDir?: string } = {},
  ) {}

  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    const base = cmd.split("/").pop() ?? cmd;
    const binDir = this.opts.testBinDir ?? process.env.UNVIBE_TEST_BIN_DIR ?? "";
    // Issue #370: with a harness fake bin dir, `gh`/`git` resolve to the
    // fakes (allowed through) or are refused loudly — never the real ones.
    if (binDir !== "" && (base === "gh" || base === "git")) {
      this.throwUnlessInsideBinDir(cmd, opts, base, binDir);
      return this.inner.run(cmd, opts);
    }
    if (TEST_BLOCKED_COMMANDS.has(base)) {
      throw new Error(
        `TestCommandGuard: refusing to spawn real "${base}" in tests ` +
          `(${cmd} ${opts.args.join(" ")}). Inject a FakeCommandRunner into ` +
          `createApp/buildApp instead (issue #119).`,
      );
    }
    return this.inner.run(cmd, opts);
  }

  /** Throw unless `cmd` resolves inside the harness fake bin dir. */
  private throwUnlessInsideBinDir(cmd: string, opts: RunOptions, base: string, binDir: string): void {
    const pathValue = opts.env?.PATH ?? process.env.PATH ?? "";
    const candidate =
      path.isAbsolute(cmd) || cmd.includes(path.sep)
        ? path.resolve(cmd)
        : findExecutableOnPath(cmd, pathValue);
    if (!candidate || !isInsideDir(candidate, binDir)) {
      throw new Error(
        `TestCommandGuard: refusing to spawn "${base}" outside the harness fake bin dir ` +
          `(${cmd} ${opts.args.join(" ")}; UNVIBE_TEST_BIN_DIR=${binDir}, ` +
          `resolved=${candidate ?? "(not found on PATH)"}). ` +
          `Test services must resolve gh/git from the harness fakes (issue #370).`,
      );
    }
  }
}
