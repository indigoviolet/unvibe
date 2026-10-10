/**
 * `git range-diff` for display (PRD §8, §15).
 *
 * Matches commits between the old and new ranges so the UI can show what a
 * rebase did. Best effort: any failure yields an empty string, never a
 * refresh failure. Uses `--no-color` for stable bytes on macOS and Linux.
 */
import type { CommandRunner } from "../exec/index.js";

export async function getRangeDiff(
  runner: CommandRunner,
  repoPath: string,
  oldBase: string,
  oldHead: string,
  newBase: string,
  newHead: string,
): Promise<string> {
  if (!oldBase || !oldHead || !newBase || !newHead) return "";
  try {
    const res = await runner.run("git", {
      args: ["range-diff", "--no-color", `${oldBase}..${oldHead}`, `${newBase}..${newHead}`, "--"],
      cwd: repoPath,
    });
    if (res.code !== 0) return "";
    return res.stdout;
  } catch {
    return "";
  }
}
