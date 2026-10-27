/**
 * Injectable command runner. All `git`/`gh` subprocess use goes through this
 * so tests can stub it with `FakeCommandRunner` — tests never hit real
 * GitHub (AGENTS.md).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

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
    return new Promise((resolve, reject) => {
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
 * Test backstop for the injectable command runner (issue #119): refuses
 * the blocked commands loudly instead of spawning the developer's real
 * tools, and delegates everything else (`git`, login shells, `d2`, …) to
 * the wrapped runner. Used as the `buildApp` default under vitest so a
 * test that forgets to inject a `FakeCommandRunner` fails with "inject a
 * fake" instead of hitting the network. Explicitly injected runners
 * (including `RealCommandRunner`) are never wrapped.
 */
export class TestCommandGuard implements CommandRunner {
  constructor(private readonly inner: CommandRunner = new RealCommandRunner()) {}

  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    const base = cmd.split("/").pop() ?? cmd;
    if (TEST_BLOCKED_COMMANDS.has(base)) {
      throw new Error(
        `TestCommandGuard: refusing to spawn real "${base}" in tests ` +
          `(${cmd} ${opts.args.join(" ")}). Inject a FakeCommandRunner into ` +
          `createApp/buildApp instead (issue #119).`,
      );
    }
    return this.inner.run(cmd, opts);
  }
}
