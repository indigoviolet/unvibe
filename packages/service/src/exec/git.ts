/**
 * `git fetch` from GitHub with the user's `gh` login (#139).
 *
 * `gh pr view` succeeds wherever `gh` is logged in, but `git fetch origin`
 * uses the remote URL and the process environment — a service started from
 * the helper app or at login may have no SSH agent and no credential
 * helper, so the view succeeds and the fetch fails. Every fetch below goes
 * through `runGitFetch`, which passes `gh auth git-credential` as a
 * per-command credential helper scoped to github.com over HTTPS, with
 * `GITHUB_TOKEN` unset (PRD §15, same as every `gh` call), so the fetch
 * authenticates as the same user the view did. Passed per command
 * (`git -c …`): never written to the user's or the repo's git config.
 * `GIT_TERMINAL_PROMPT=0` everywhere: the service has no terminal, so a
 * credential prompt must fail fast, never hang.
 *
 * SSH remotes (`git@github.com:`, `ssh://`) never consult credential
 * helpers, so they keep relying on the user's SSH agent/keys, unchanged —
 * as do non-GitHub HTTPS remotes (the helper is host-scoped to github.com).
 */
import type { CommandRunner, RunOptions, RunResult } from "./runner.js";

/** Per-command git config: `gh` fills credentials for github.com HTTPS only. */
export function gitHubCredentialConfig(): string[] {
  return ["-c", "credential.https://github.com.helper=!gh auth git-credential"];
}

export interface GitFetchOptions {
  cwd: string;
  timeoutMs?: number;
  /** Extra env on top of the unset-GITHUB_TOKEN, no-prompt baseline. */
  env?: Record<string, string | undefined>;
}

/** `git fetch origin …` with the #139 credential handling (never throws by itself). */
export async function runGitFetch(
  runner: CommandRunner,
  refspecs: string[],
  opts: GitFetchOptions,
): Promise<RunResult> {
  const runOpts: RunOptions = {
    args: [...gitHubCredentialConfig(), "fetch", "origin", ...refspecs],
    cwd: opts.cwd,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    env: { GITHUB_TOKEN: undefined, GIT_TERMINAL_PROMPT: "0", ...opts.env },
  };
  return runner.run("git", runOpts);
}
