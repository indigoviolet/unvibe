/**
 * Context-repo reading locations (issue #222): the worktrees of a
 * registered repo, plus resolution of one document context-repo pick
 * (a particular worktree, `origin/main`, or the local copy) to the
 * stored `ContextRepoRef`. All git goes through the injectable runner.
 */
import type { ContextRepoRef, ContextRepoSource, Repo, RepoWorktree } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";

async function git(runner: CommandRunner, args: string[], cwd: string): Promise<string | null> {
  try {
    const res = await runner.run("git", { args, cwd });
    return res.code === 0 ? res.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Worktrees of the checkout at `repoPath` (`git worktree list --porcelain`). */
export async function listWorktrees(runner: CommandRunner, repoPath: string): Promise<RepoWorktree[]> {
  const out = await git(runner, ["worktree", "list", "--porcelain"], repoPath);
  if (!out) return [];
  const worktrees: RepoWorktree[] = [];
  let cur: RepoWorktree | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length).trim() };
      worktrees.push(cur);
    } else if (cur && line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length).trim();
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  return worktrees;
}

export interface ResolvedContextRepo {
  ref: ContextRepoRef;
}

/**
 * Resolve one owner pick to its stored ref. Throws a human message the
 * create route surfaces verbatim (unknown worktree, missing ref).
 */
export async function resolveContextRepo(
  runner: CommandRunner,
  repo: Repo,
  source: ContextRepoSource,
  worktreePath?: string,
): Promise<ContextRepoRef> {
  const base = { repoId: repo.id, owner: repo.owner, name: repo.name, repoPath: repo.localPath };
  if (source === "local") {
    const sha = await git(runner, ["rev-parse", "HEAD"], repo.localPath);
    return { ...base, source, path: repo.localPath, ...(sha ? { sha } : {}), label: `${repo.owner}/${repo.name} · local copy` };
  }
  if (source === "origin-main") {
    const sha = await git(runner, ["rev-parse", "origin/main"], repo.localPath);
    if (!sha) throw new Error(`${repo.owner}/${repo.name} has no origin/main to read`);
    return { ...base, source, path: repo.localPath, sha, label: `${repo.owner}/${repo.name} · origin/main` };
  }
  // source === "worktree": the path must be one of the repo's worktrees.
  if (!worktreePath) throw new Error(`pick a worktree for ${repo.owner}/${repo.name}`);
  const worktrees = await listWorktrees(runner, repo.localPath);
  const found = worktrees.find((w) => w.path === worktreePath);
  if (!found) throw new Error(`${worktreePath} is not a worktree of ${repo.owner}/${repo.name}`);
  const sha = found.head ?? (await git(runner, ["rev-parse", "HEAD"], found.path));
  return {
    ...base,
    source,
    path: found.path,
    worktreePath: found.path,
    ...(sha ? { sha } : {}),
    label: `${repo.owner}/${repo.name} · worktree ${found.branch ?? found.path}`,
  };
}
