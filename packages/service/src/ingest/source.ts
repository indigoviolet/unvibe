/**
 * Source resolution (ingest, PRD §11.1 step 1 + §15).
 *
 * - PR: `gh pr view <n> --json …` for metadata, then `git fetch` (best
 *   effort: forks may only be reachable as `pull/<n>/head`), then the
 *   merge-base and a local `git diff` (more reliable than `gh pr diff` for
 *   large PRs, PRD §15).
 * - Branch: `git fetch` (best effort for remote-less test repos), head via
 *   `git rev-parse`, base = upstream → default branch → root commit.
 *
 * All commands go through the injectable `CommandRunner`; `gh` runs with
 * `GITHUB_TOKEN` unset (PRD §15). Fetch failures never fail ingest: local
 * branches and test fixtures have no remote.
 */
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";
import type { CommitMessage } from "./description.js";

export interface IngestSource {
  /** Absolute path of the user's checkout (never written to). */
  repoPath: string;
  pr?: number;
  branch?: string;
}

export interface PrInfo {
  title: string;
  body: string;
  authorLogin: string;
  /** OPEN | CLOSED | MERGED (gh `state` field). */
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
}

export interface ResolvedSource {
  /** Display title: PR title or branch name. */
  title: string;
  branch: string;
  prNumber?: number;
  baseRef: string;
  headSha: string;
  mergeBaseSha: string;
  diffText: string;
  descriptionMarkdown: string;
  commits: CommitMessage[];
  /** M1 approximation of "user authors an open PR" (PRD §4.11). */
  descriptionEditable: boolean;
  worktreePath: string;
}

async function runGit(
  runner: CommandRunner,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string }> {
  const res = await runner.run("git", { args, cwd });
  return { ok: res.code === 0, stdout: res.stdout };
}

async function bestEffortFetch(runner: CommandRunner, repoPath: string, ref: string): Promise<void> {
  try {
    await runner.run("git", { args: ["fetch", "origin", ref], cwd: repoPath });
  } catch {
    // No remote / offline / test fixture: ingest proceeds with local refs.
  }
}

export async function fetchPrInfo(
  runner: CommandRunner,
  repoPath: string,
  pr: number,
): Promise<PrInfo> {
  const args = [
    "pr",
    "view",
    String(pr),
    "--json",
    "title,body,author,state,isDraft,baseRefName,headRefName,headRefOid",
  ];
  const res = await runGh(runner, args, { args, cwd: repoPath });
  if (res.code !== 0) {
    throw new Error(`gh pr view ${pr} failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  const json = JSON.parse(res.stdout) as {
    title: string;
    body: string;
    author: { login: string };
    state: string;
    isDraft: boolean;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
  };
  return {
    title: json.title ?? `PR #${pr}`,
    body: json.body ?? "",
    authorLogin: json.author?.login ?? "",
    state: json.state ?? "",
    isDraft: json.isDraft ?? false,
    baseRefName: json.baseRefName ?? "",
    headRefName: json.headRefName ?? "",
    headRefOid: json.headRefOid ?? "",
  };
}

/** Commits in merge-base..head order (oldest first), null-separated. */
export async function readCommitMessages(
  runner: CommandRunner,
  repoPath: string,
  mergeBase: string,
  head: string,
): Promise<CommitMessage[]> {
  const res = await runGit(runner, [
    "log",
    "--reverse",
    "--format=%H%x00%s%x00%b%x1e",
    `${mergeBase}..${head}`,
  ], repoPath);
  if (!res.ok) return [];
  const commits: CommitMessage[] = [];
  for (const record of res.stdout.split("\x1e")) {
    const trimmed = record.replace(/^\n+/, "");
    if (!trimmed.trim()) continue;
    const [sha = "", subject = "", body = ""] = trimmed.split("\0");
    if (!sha) continue;
    commits.push({ sha: sha.trim(), subject: subject.trim(), body: body.trim() });
  }
  return commits;
}

/** Default branch from `origin/HEAD`, e.g. `origin/main`. Null when unknown. */
async function defaultBranch(runner: CommandRunner, repoPath: string): Promise<string | null> {
  const res = await runGit(runner, ["symbolic-ref", "refs/remotes/origin/HEAD"], repoPath);
  if (!res.ok) return null;
  const ref = res.stdout.trim().replace(/^refs\/remotes\//, "");
  return ref || null;
}

async function resolveBranchBase(
  runner: CommandRunner,
  repoPath: string,
  branch: string,
  headSha: string,
): Promise<{ baseRef: string; mergeBaseSha: string }> {
  const candidates: string[] = [];
  const upstream = await runGit(runner, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], repoPath);
  if (upstream.ok && upstream.stdout.trim()) candidates.push(upstream.stdout.trim());
  const def = await defaultBranch(runner, repoPath);
  if (def) candidates.push(def);
  for (const fallback of ["origin/main", "origin/master", "main", "master"]) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  for (const base of candidates) {
    const mb = await runGit(runner, ["merge-base", base, headSha], repoPath);
    if (mb.ok && mb.stdout.trim()) {
      return { baseRef: base, mergeBaseSha: mb.stdout.trim().split("\n")[0] };
    }
  }
  // Degenerate (remote-less single-branch fixture): diff against the root.
  const root = await runGit(runner, ["rev-list", "--max-parents=0", headSha], repoPath);
  const rootSha = root.ok ? root.stdout.trim().split("\n")[0] : headSha;
  return { baseRef: branch, mergeBaseSha: rootSha ?? headSha };
}

/**
 * Ensure the managed worktree for a review exists at `<dataDir>/worktrees/<id>`
 * and points at `headSha`; reuse when it already does. Never writes into the
 * user's checkout (PRD §14).
 */
export async function ensureWorktree(
  runner: CommandRunner,
  repoPath: string,
  dataDir: string,
  id: string,
  headSha: string,
): Promise<string> {
  const { default: path } = await import("node:path");
  const { default: fs } = await import("node:fs");
  const wt = path.join(dataDir, "worktrees", id);
  try {
    if (fs.existsSync(wt)) {
      const cur = await runGit(runner, ["rev-parse", "HEAD"], wt);
      if (cur.ok && cur.stdout.trim() === headSha) return wt;
      // Stale worktree dir: remove and re-add below.
      await runner.run("git", { args: ["worktree", "remove", "--force", wt], cwd: repoPath });
      fs.rmSync(wt, { recursive: true, force: true });
      await runner.run("git", { args: ["worktree", "prune"], cwd: repoPath });
    }
  } catch {
    // Fall through to re-add.
  }
  const res = await runner.run("git", { args: ["worktree", "add", wt, headSha], cwd: repoPath });
  if (res.code !== 0) {
    throw new Error(`git worktree add failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  return wt;
}

/** Resolve a PR or branch source to SHAs + diff text + worktree. */
export async function resolveSource(
  runner: CommandRunner,
  source: IngestSource,
  dataDir: string,
  reviewId: string,
): Promise<ResolvedSource> {
  const { repoPath } = source;
  let title: string;
  let branch: string;
  let prNumber: number | undefined;
  let baseRef: string;
  let headSha: string;
  let descriptionMarkdown = "";
  let descriptionEditable = false;

  if (source.pr !== undefined) {
    const info = await fetchPrInfo(runner, repoPath, source.pr);
    prNumber = source.pr;
    title = info.title;
    branch = info.headRefName;
    baseRef = info.baseRefName;
    headSha = info.headRefOid;
    descriptionMarkdown = info.body;
    // M1 approximation: editable when the PR is open. The author check
    // needs the viewer login (an extra `gh api user` call); M4 refines it.
    descriptionEditable = info.state === "OPEN";
    await bestEffortFetch(runner, repoPath, info.headRefName);
    if (!headSha) {
      const local = await runGit(runner, ["rev-parse", info.headRefName], repoPath);
      if (!local.ok) throw new Error(`cannot resolve PR head ${info.headRefName}`);
      headSha = local.stdout.trim();
    }
    await bestEffortFetch(runner, repoPath, baseRef);
  } else if (source.branch !== undefined) {
    branch = source.branch;
    title = source.branch;
    await bestEffortFetch(runner, repoPath, branch);
    let head = await runGit(runner, ["rev-parse", branch], repoPath);
    if (!head.ok) {
      head = await runGit(runner, ["rev-parse", `origin/${branch}`], repoPath);
    }
    if (!head.ok) throw new Error(`cannot resolve branch ${branch}`);
    headSha = head.stdout.trim();
    const base = await resolveBranchBase(runner, repoPath, branch, headSha);
    baseRef = base.baseRef;
    const mergeBaseSha = base.mergeBaseSha;
    return finishResolve(runner, {
      repoPath, title, branch, prNumber, baseRef, headSha, mergeBaseSha,
      descriptionMarkdown: "", descriptionEditable: false, dataDir, reviewId,
    });
  } else {
    throw new Error("ingest needs either pr or branch");
  }

  const mb = await runGit(runner, ["merge-base", baseRef, headSha], repoPath);
  if (!mb.ok || !mb.stdout.trim()) {
    throw new Error(`cannot compute merge-base of ${baseRef} and ${headSha}`);
  }
  const mergeBaseSha = mb.stdout.trim().split("\n")[0];
  return finishResolve(runner, {
    repoPath, title, branch, prNumber, baseRef, headSha, mergeBaseSha,
    descriptionMarkdown, descriptionEditable, dataDir, reviewId,
  });
}

async function finishResolve(
  runner: CommandRunner,
  r: {
    repoPath: string;
    title: string;
    branch: string;
    prNumber?: number;
    baseRef: string;
    headSha: string;
    mergeBaseSha: string;
    descriptionMarkdown: string;
    descriptionEditable: boolean;
    dataDir: string;
    reviewId: string;
  },
): Promise<ResolvedSource> {
  const diff = await runGit(
    runner,
    ["diff", "-U3", "-M", "--no-color", "--no-ext-diff", r.mergeBaseSha, r.headSha, "--"],
    r.repoPath,
  );
  if (!diff.ok) throw new Error(`git diff failed for ${r.headSha}`);
  const commits = await readCommitMessages(runner, r.repoPath, r.mergeBaseSha, r.headSha);
  const worktreePath = await ensureWorktree(runner, r.repoPath, r.dataDir, r.reviewId, r.headSha);
  return {
    title: r.title,
    branch: r.branch,
    ...(r.prNumber !== undefined ? { prNumber: r.prNumber } : {}),
    baseRef: r.baseRef,
    headSha: r.headSha,
    mergeBaseSha: r.mergeBaseSha,
    diffText: diff.stdout,
    descriptionMarkdown: r.descriptionMarkdown,
    commits,
    descriptionEditable: r.descriptionEditable,
    worktreePath,
  };
}

/**
 * Lightweight re-resolution for `POST /reviews/:id/refresh`: fetch, then
 * report whether the head SHA moved. No version is created here (M5 seam:
 * version creation + ID mapping happens in the M5 update pass).
 */
export async function resolveHead(
  runner: CommandRunner,
  repoPath: string,
  opts: { pr?: number; branch?: string },
): Promise<{ headSha: string; baseRef: string }> {
  if (opts.pr !== undefined) {
    const info = await fetchPrInfo(runner, repoPath, opts.pr);
    await bestEffortFetch(runner, repoPath, info.headRefName);
    let headSha = info.headRefOid;
    if (!headSha) {
      const local = await runGit(runner, ["rev-parse", info.headRefName], repoPath);
      headSha = local.ok ? local.stdout.trim() : "";
    }
    return { headSha, baseRef: info.baseRefName };
  }
  const branch = opts.branch ?? "";
  await bestEffortFetch(runner, repoPath, branch);
  let head = await runGit(runner, ["rev-parse", branch], repoPath);
  if (!head.ok) head = await runGit(runner, ["rev-parse", `origin/${branch}`], repoPath);
  return { headSha: head.ok ? head.stdout.trim() : "", baseRef: branch };
}
