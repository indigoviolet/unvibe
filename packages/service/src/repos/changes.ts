/**
 * Start-page changes for one repo (PRD §§4.2/15):
 *
 * - PRs you author: `gh search prs --author @me --repo <o/n>`;
 * - PRs awaiting your review: `gh search prs --review-requested @me --repo …`;
 * - recent local and remote branches via git;
 * - reviews opened before, with stale state (head moved since fetch).
 *
 * All commands go through the injectable `CommandRunner`; `gh` runs with
 * `GITHUB_TOKEN` unset. Every external call is best-effort: an offline or
 * logged-out `gh` still yields branches + previous reviews.
 */
import type { ChangesFilter, Repo, RepoChange } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

export interface ChangesDeps {
  runner: CommandRunner;
  db: DatabaseSync;
}

const BRANCH_LIMIT = 30;
const PR_LIMIT = 30;

interface GhPr {
  number: number;
  title: string;
  author?: { login: string };
  updatedAt?: string;
}

/** `gh search prs … --json number,title,author,updatedAt`, [] on failure. */
async function searchPrs(
  runner: CommandRunner,
  repo: Repo,
  extra: string[],
): Promise<RepoChange[]> {
  if (repo.owner === "local") return [];
  const args = [
    "search",
    "prs",
    "--repo",
    `${repo.owner}/${repo.name}`,
    ...extra,
    "--state",
    "open",
    "--json",
    "number,title,author,updatedAt",
    "--limit",
    String(PR_LIMIT),
  ];
  try {
    const res = await runGh(runner, args, { args, cwd: repo.localPath });
    if (res.code !== 0) return [];
    const prs = JSON.parse(res.stdout) as GhPr[];
    if (!Array.isArray(prs)) return [];
    return prs.map((pr) => ({
      kind: "pr" as const,
      title: pr.title || `PR #${pr.number}`,
      prNumber: pr.number,
      ...(pr.author?.login ? { author: pr.author.login } : {}),
      ...(pr.updatedAt
        ? { updatedAt: Date.parse(pr.updatedAt) || undefined }
        : {}),
    }));
  } catch {
    return [];
  }
}

interface BranchRow {
  name: string;
  updatedAt: number;
}

/**
 * Clean one `%(refname:short)` line: strip the `* ` current marker, skip
 * detached-HEAD pseudo entries, strip the `origin/` prefix for remotes.
 */
function cleanBranchName(raw: string, remotePrefix: string | null): string | null {
  let name = raw.trimEnd();
  if (name.startsWith("* ")) name = name.slice(2).trim();
  if (name === "" || name === "HEAD" || name.startsWith("(")) return null;
  if (remotePrefix) {
    if (!name.startsWith(remotePrefix)) return null;
    name = name.slice(remotePrefix.length);
    if (name === "HEAD" || name.includes(" -> ")) return null;
  }
  return name || null;
}

/**
 * Names + committer dates via two identically-sorted calls (`git branch`
 * `--format` has no escape for a field separator, so fields cannot share
 * one call). Returns newest first, capped.
 */
async function readBranches(
  runner: CommandRunner,
  cwd: string,
  remote: boolean,
): Promise<BranchRow[]> {
  const base = remote ? ["branch", "-r"] : ["branch"];
  let names: { code: number; stdout: string };
  let dates: { code: number; stdout: string };
  try {
    [names, dates] = await Promise.all([
      runner.run("git", { args: [...base, "--sort=-committerdate", "--format=%(refname:short)"], cwd }),
      runner.run("git", { args: [...base, "--sort=-committerdate", "--format=%(committerdate:unix)"], cwd }),
    ]);
  } catch {
    return [];
  }
  if (names.code !== 0) return [];
  const nameLines = names.stdout.split("\n");
  const dateLines = dates.code === 0 ? dates.stdout.split("\n") : [];
  const rows: BranchRow[] = [];
  for (let i = 0; i < nameLines.length && rows.length < BRANCH_LIMIT; i++) {
    const name = cleanBranchName(nameLines[i], remote ? "origin/" : null);
    if (!name) continue;
    const unix = Number((dateLines[i] ?? "").trim());
    rows.push({ name, updatedAt: Number.isSafeInteger(unix) ? unix * 1000 : 0 });
  }
  return rows;
}

async function listBranches(runner: CommandRunner, repo: Repo): Promise<RepoChange[]> {
  const out: RepoChange[] = [];
  const push = (b: BranchRow): void => {
    out.push({
      kind: "branch",
      title: b.name,
      branch: b.name,
      ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
    });
  };
  try {
    for (const b of await readBranches(runner, repo.localPath, false)) push(b);
  } catch {
    // No git, no branches — reviews below still work.
  }
  try {
    for (const b of await readBranches(runner, repo.localPath, true)) {
      if (out.some((c) => c.branch === b.name)) continue;
      push(b);
    }
  } catch {
    // Remote branches are optional.
  }
  return out;
}

interface ReviewRow {
  id: string;
  branch: string;
  pr_number: number | null;
  head_sha: string | null;
}

/** Reviews opened before, with stale state (head moved since fetch). #92: loading reviews (no versions row yet) show too. */
async function listPreviousReviews(
  runner: CommandRunner,
  db: DatabaseSync,
  repo: Repo,
): Promise<RepoChange[]> {
  let rows: ReviewRow[];
  try {
    rows = (db
      .prepare(
        `SELECT r.id, r.branch, r.pr_number, v.head_sha
         FROM reviews r LEFT JOIN versions v
           ON v.review_id = r.id AND v.n = r.current_version
         WHERE r.repo_id = ? ORDER BY r.created_at DESC`,
      )
      .all(repo.id) as unknown) as ReviewRow[];
  } catch {
    return [];
  }
  const out: RepoChange[] = [];
  for (const row of rows) {
    let stale = false;
    if (row.head_sha) {
      try {
        const tip = await runner.run("git", { args: ["rev-parse", row.branch], cwd: repo.localPath });
        if (tip.code === 0 && tip.stdout.trim() && tip.stdout.trim() !== row.head_sha) {
          stale = true;
        }
      } catch {
        // Unresolvable tip: not stale as far as we know.
      }
    }
    // #92: loading PRs carry a `pr-<n>` branch placeholder until the ingest
    // confirms the head branch — show just `#N` until then.
    const title =
      row.pr_number !== null
        ? row.branch && !row.branch.startsWith("pr-")
          ? `#${row.pr_number} · ${row.branch}`
          : `#${row.pr_number}`
        : row.branch;
    out.push({
      kind: "review",
      title,
      ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
      branch: row.branch,
      reviewId: row.id,
      stale,
    });
  }
  return out;
}

/**
 * Changes for the start page. `filter` narrows the sections:
 * `authoring` / `review-requested` (one `gh` call each), `branches`
 * (git only), `recent` (branches + previous reviews), `all` (default).
 */
export async function repoChanges(
  deps: ChangesDeps,
  repo: Repo,
  filter: ChangesFilter = "all",
): Promise<RepoChange[]> {
  switch (filter) {
    case "authoring":
      return searchPrs(deps.runner, repo, ["--author", "@me"]);
    case "review-requested":
      return searchPrs(deps.runner, repo, ["--review-requested", "@me"]);
    case "branches":
      return listBranches(deps.runner, repo);
    case "recent":
      return [
        ...(await listBranches(deps.runner, repo)),
        ...(await listPreviousReviews(deps.runner, deps.db, repo)),
      ];
    case "all":
    default:
      return [
        ...(await searchPrs(deps.runner, repo, ["--author", "@me"])),
        ...(await searchPrs(deps.runner, repo, ["--review-requested", "@me"])),
        ...(await listBranches(deps.runner, repo)),
        ...(await listPreviousReviews(deps.runner, deps.db, repo)),
      ];
  }
}
