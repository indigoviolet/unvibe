/**
 * Start-page changes for one repo (PRD §§4.2/15):
 *
 * - PRs you author: `gh pr list --author @me --repo <o/n>`;
 * - PRs awaiting your review: `gh pr list --search
 *   "review-requested:@me" --repo …` (direct + team) alongside `gh pr
 *   list --search "user-review-requested:@me" --repo …` (direct only, #95);
 * - recent local and remote branches via git;
 * - reviews opened before, with stale state (head moved since fetch).
 *
 * `gh pr list --json` returns every PR field the rows need in one call
 * per list — head branch (#91), diff size (#100), the PR URL (#94) and
 * review requests (#95) — where `gh search prs` could return none of
 * them. All commands go through the injectable `CommandRunner`; `gh`
 * runs with `GITHUB_TOKEN` unset. Every external call is best-effort: an
 * offline or logged-out `gh` still yields branches + previous reviews.
 */
import type { ChangesFilter, Repo, RepoChange } from "@unvibe/shared";
import { displayedReviewDecision, prStateFromGh } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

export interface ChangesDeps {
  runner: CommandRunner;
  db: DatabaseSync;
}

const BRANCH_LIMIT = 30;
const PR_LIMIT = 30;

interface GhReviewRequest {
  __typename?: string;
  login?: string;
  slug?: string;
  name?: string;
}

interface GhPr {
  number: number;
  title: string;
  author?: { login: string };
  updatedAt?: string;
  headRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  url?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  reviewRequests?: GhReviewRequest[];
  latestReviews?: unknown;
}

/**
 * Every PR field the start-page rows need, in one `gh` call per list.
 * Fields `gh` cannot return in one call are simply absent (the row omits
 * that part) — never one call per PR.
 */
const PR_FIELDS = "number,title,author,updatedAt,headRefName,additions,deletions,changedFiles,url,state,isDraft,reviewDecision,reviewRequests,latestReviews";

/** One `gh pr list` call; null on any failure (best-effort listing). */
async function listPrs(
  runner: CommandRunner,
  repo: Repo,
  extra: string[],
): Promise<GhPr[] | null> {
  if (repo.owner === "local") return [];
  const args = [
    "pr",
    "list",
    "--repo",
    `${repo.owner}/${repo.name}`,
    ...extra,
    "--json",
    PR_FIELDS,
    "--limit",
    String(PR_LIMIT),
  ];
  try {
    const res = await runGh(runner, args, { args, cwd: repo.localPath });
    if (res.code !== 0) return null;
    const prs = JSON.parse(res.stdout) as GhPr[];
    if (!Array.isArray(prs)) return null;
    return prs;
  } catch {
    return null;
  }
}

function toCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Team slugs (or names) from `gh`'s `reviewRequests` (#95). */
function requestedTeams(pr: GhPr): string[] {
  const out: string[] = [];
  for (const r of pr.reviewRequests ?? []) {
    if (typeof r !== "object" || r === null) continue;
    // User requests carry `login`; team requests carry `slug` (fall back
    // to `name` — `gh` has returned both shapes).
    if (typeof r.login === "string" && r.login !== "") continue;
    const team = [r.slug, r.name].find((s) => typeof s === "string" && s !== "");
    if (team && !out.includes(team)) out.push(team);
  }
  return out;
}

function toChange(pr: GhPr): RepoChange {
  const additions = toCount(pr.additions);
  const deletions = toCount(pr.deletions);
  const changedFiles = toCount(pr.changedFiles);
  const teams = requestedTeams(pr);
  const prState = prStateFromGh(pr.state, pr.isDraft);
  // #230: the displayed decision — re-requested changes_requested hides,
  // review_required never shows.
  const reviewDecision = displayedReviewDecision({
    reviewDecision: pr.reviewDecision,
    reviewRequests: pr.reviewRequests,
    latestReviews: pr.latestReviews,
  });
  return {
    kind: "pr" as const,
    title: pr.title || `PR #${pr.number}`,
    prNumber: pr.number,
    ...(pr.author?.login ? { author: pr.author.login } : {}),
    ...(pr.updatedAt ? { updatedAt: Date.parse(pr.updatedAt) || undefined } : {}),
    // #91: the head branch `gh search prs` could never return.
    ...(typeof pr.headRefName === "string" && pr.headRefName !== "" ? { branch: pr.headRefName } : {}),
    // #94: prefer the URL `gh` returns; the web falls back to building it.
    ...(typeof pr.url === "string" && pr.url !== "" ? { url: pr.url } : {}),
    // #100: diff size; omitted when unknown.
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    // #224: PR state + review decision badges.
    ...(prState !== undefined ? { prState } : {}),
    ...(reviewDecision !== undefined ? { reviewDecision } : {}),
    ...(teams.length > 0 ? { requestedTeams: teams } : {}),
  };
}

/** Newest first; rows without a time sort last (stable). */
function byUpdatedDesc(a: RepoChange, b: RepoChange): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
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

/**
 * #149: existing reviews per source for the row markers (most recently
 * active review wins when stored duplicates meet). PR sources key by PR
 * number; branch sources key by branch with no PR number — a PR review
 * and a branch review of the same branch are different sources.
 */
interface ReviewMark {
  id: string;
  stale: boolean;
}

interface ReviewMarks {
  pr: Map<number, ReviewMark>;
  branch: Map<string, ReviewMark>;
}

function reviewMarksFor(db: DatabaseSync, repoId: string): ReviewMarks {
  const marks: ReviewMarks = { pr: new Map(), branch: new Map() };
  let rows: { id: string; pr_number: number | null; branch: string; snapshot: string | null }[];
  try {
    rows = db
      .prepare(
        `SELECT r.id AS id, r.pr_number AS pr_number, r.branch AS branch, rs.snapshot AS snapshot
         FROM reviews r LEFT JOIN review_snapshots rs ON rs.review_id = r.id
         WHERE r.repo_id = ? ORDER BY COALESCE(rs.updated_at, r.created_at) DESC`,
      )
      .all(repoId) as unknown as typeof rows;
  } catch {
    return marks;
  }
  for (const row of rows) {
    let stale = false;
    if (row.snapshot) {
      try {
        stale = (JSON.parse(row.snapshot) as { versionStatus?: { stale?: boolean } }).versionStatus?.stale ?? false;
      } catch {
        // Unreadable snapshot: not stale as far as we know.
      }
    }
    const mark: ReviewMark = { id: row.id, stale };
    if (row.pr_number !== null) {
      if (!marks.pr.has(row.pr_number)) marks.pr.set(row.pr_number, mark);
    } else {
      if (!marks.branch.has(row.branch)) marks.branch.set(row.branch, mark);
    }
  }
  return marks;
}

/** #149: mark PR/branch rows that already have a review (open, not start). */
function attachReviewMarks(changes: RepoChange[], marks: ReviewMarks): RepoChange[] {
  return changes.map((c) => {
    if (c.kind === "pr" && c.prNumber !== undefined) {
      const m = marks.pr.get(c.prNumber);
      if (m) return { ...c, reviewId: m.id, ...(m.stale ? { stale: true } : {}) };
    } else if (c.kind === "branch" && c.branch) {
      const m = marks.branch.get(c.branch);
      if (m) return { ...c, reviewId: m.id, ...(m.stale ? { stale: true } : {}) };
    }
    return c;
  });
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
 * PRs awaiting review (#95): direct requests (`user-review-requested:@me`)
 * plus team requests (`review-requested:@me` minus the direct ones — a PR
 * asking both shows once, as direct). One `gh` call per list, never per
 * PR. When the direct call fails the distinction is unknown and rows
 * carry no scope (the web shows them as direct, as before).
 */
async function requestedPrs(runner: CommandRunner, repo: Repo): Promise<RepoChange[]> {
  const [direct, all] = await Promise.all([
    listPrs(runner, repo, ["--search", "user-review-requested:@me"]),
    listPrs(runner, repo, ["--search", "review-requested:@me"]),
  ]);
  if (all === null) {
    // The team-inclusive call failed: fall back to the direct rows alone
    // (also [] when that call failed) rather than an empty list.
    return (direct ?? []).map((pr) => ({ ...toChange(pr), reviewScope: "direct" as const })).sort(byUpdatedDesc);
  }
  if (direct === null) {
    // The distinction is unknown: return the rows without a scope (the
    // web shows unscoped rows as direct, as before) rather than
    // mislabelled.
    return all.map(toChange).sort(byUpdatedDesc);
  }
  const directNumbers = new Set(direct.map((pr) => pr.number));
  return all
    .map((pr) => ({
      ...toChange(pr),
      reviewScope: (directNumbers.has(pr.number) ? "direct" : "team") as "direct" | "team",
    }))
    .sort(byUpdatedDesc);
}

/**
 * Changes for the start page. `filter` narrows the sections:
 * `authoring` (one `gh` call), `review-requested` (two `gh` calls: direct
 * + team-inclusive, #95), `branches` (git only), `recent` (branches +
 * previous reviews), `all` (default).
 */
export async function repoChanges(
  deps: ChangesDeps,
  repo: Repo,
  filter: ChangesFilter = "all",
): Promise<RepoChange[]> {
  // #149: one DB read per listing; PR/branch rows that already have a
  // review carry its id (previous-review rows already carry their own).
  const marks = reviewMarksFor(deps.db, repo.id);
  switch (filter) {
    case "authoring":
      return attachReviewMarks(
        ((await listPrs(deps.runner, repo, ["--author", "@me"])) ?? []).map(toChange).sort(byUpdatedDesc),
        marks,
      );
    case "review-requested":
      return attachReviewMarks(await requestedPrs(deps.runner, repo), marks);
    case "branches":
      return attachReviewMarks(await listBranches(deps.runner, repo), marks);
    case "recent":
      return [
        ...attachReviewMarks(await listBranches(deps.runner, repo), marks),
        ...(await listPreviousReviews(deps.runner, deps.db, repo)),
      ];
    case "all":
    default:
      return [
        ...attachReviewMarks(
          ((await listPrs(deps.runner, repo, ["--author", "@me"])) ?? []).map(toChange).sort(byUpdatedDesc),
          marks,
        ),
        ...attachReviewMarks(await requestedPrs(deps.runner, repo), marks),
        ...attachReviewMarks(await listBranches(deps.runner, repo), marks),
        ...(await listPreviousReviews(deps.runner, deps.db, repo)),
      ];
  }
}
