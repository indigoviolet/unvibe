/**
 * Two context repos (issue #222, wired with #81): a `code:` citation and
 * a `get_code` call carry only path + lines + sha — no repo name. The
 * repo is resolved from the sha: the first context repo (in the order
 * the owner picked them) whose object store contains the cited commit
 * is the repo meant. A sha in neither repo resolves to nothing, so the
 * citation stays unverified and reads fail instead of silently reading
 * the same path in the wrong repo. No grammar change and no new tool
 * input: the golden `get_code` surface stays frozen.
 */
import type { ContextRepoRef } from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { readCodeSlice } from "../mcp/read.js";

/** The first context repo containing `sha`, or null when neither does. */
export async function repoContainingSha(
  runner: CommandRunner,
  refs: readonly ContextRepoRef[],
  sha: string,
): Promise<ContextRepoRef | null> {
  if (!/^[0-9a-fA-F]{4,64}$/.test(sha)) return null;
  for (const ref of refs) {
    try {
      const res = await runner.run("git", { args: ["cat-file", "-e", `${sha}^{commit}`], cwd: ref.repoPath });
      if (res.code === 0) return ref;
    } catch {
      // Try the next repo.
    }
  }
  return null;
}

/**
 * Existence set for `code:` targets in a document answer (#81's
 * existence-only rule, per repo): a `path@sha` key counts when the file
 * exists at its cited commit in the repo that contains that commit (so
 * the same path at a sha in neither repo stays unverified). Reads go
 * through `readCodeSlice`, the same `git show` source as `get_code`.
 * Never throws.
 */
export async function resolveDocumentCodeExistence(
  runner: CommandRunner,
  refs: readonly ContextRepoRef[],
  targets: Iterable<string>,
): Promise<Set<string>> {
  const seen = new Map<string, string>();
  for (const target of targets) {
    const parsed = parseId(target);
    if (parsed?.kind !== "code") continue;
    if (parsed.sha && !seen.has(parsed.path)) seen.set(parsed.path, parsed.sha);
  }
  const out = new Set<string>();
  for (const [filePath, rev] of seen) {
    if (!filePath || filePath.includes("\0") || filePath.startsWith("/") || filePath.split(/[\\/]/).includes("..")) continue;
    const ref = await repoContainingSha(runner, refs, rev);
    if (!ref) continue;
    const slice = await readCodeSlice(runner, ref.repoPath, rev, filePath, 1, 1);
    if ("totalLines" in slice && slice.totalLines !== undefined) out.add(`${filePath}@${rev}`);
  }
  return out;
}
