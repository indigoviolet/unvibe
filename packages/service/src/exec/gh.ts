/**
 * `gh` wrapper. Runs `gh` with `GITHUB_TOKEN` unset (PRD §15): a token in the
 * environment without the needed scopes can override the `gh` keyring login.
 */
import type { CommandRunner, RunOptions, RunResult } from "./runner.js";

export interface GhOptions extends Omit<RunOptions, "env"> {
  /** Extra env on top of the GITHUB_TOKEN-unset baseline. */
  env?: Record<string, string | undefined>;
}

export async function runGh(
  runner: CommandRunner,
  args: string[],
  opts: GhOptions,
): Promise<RunResult> {
  const { env, ...rest } = opts;
  return runner.run("gh", {
    ...rest,
    args,
    env: { GITHUB_TOKEN: undefined, ...env },
  });
}
